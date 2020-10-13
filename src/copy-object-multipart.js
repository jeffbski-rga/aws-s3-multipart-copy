"use strict";

const COPY_PART_SIZE_MINIMUM_BYTES = 5242880; // 5MB in bytes
const DEFAULT_COPY_PART_SIZE_BYTES = 50000000; // 50 MB in bytes
const DEFAULT_COPIED_OBJECT_PERMISSIONS = "private";

function createDeps(s3, log) {
  return {
    log,
    s3CreateMultipartUpload: (...rest) => s3.createMultipartUpload(...rest).promise(),
    s3UploadPartCopy: (...rest) => s3.uploadPartCopy(...rest).promise(),
    s3AbortMultipartUpload: (...rest) => s3.abortMultipartUpload(...rest).promise(),
    s3ListParts: (...rest) => s3.listParts(...rest).promise(),
    s3CompleteMultipartUpload: (...rest) => s3.completeMultipartUpload(...rest).promise(),
  };
}

/**
 * Throws the error of initiateMultipartCopy in case such occures
 * @param {*} deps an object of dependencies
 * @param deps.log an object logger
 * @param deps.s3CreateMultipartUpload
 * @param deps.s3UploadPartCopy
 * @param deps.s3AbortMultipartUpload
 * @param deps.s3ListParts
 * @param deps.s3CompleteMultipartUpload
 * @param {*} options an object of parameters obligated to hold the below keys
 * (note that copy_part_size_bytes, copied_object_permissions, expiration_period are optional and will be assigned with default values if not given)
 * @param {*} request_context optional parameter for logging purposes
 */
async function copyObjectMultipart(
  deps,
  {
    source_bucket,
    object_key,
    destination_bucket,
    copied_object_name,
    object_size,
    copy_part_size_bytes,
    copied_object_permissions,
    expiration_period,
    server_side_encryption,
    content_type,
    content_disposition,
    content_encoding,
    content_language,
    metadata,
    cache_control,
  },
  request_context
) {
  const { log } = deps;
  const upload_id = await initiateMultipartCopy(
    deps,
    destination_bucket,
    copied_object_name,
    copied_object_permissions,
    expiration_period,
    request_context,
    server_side_encryption,
    content_type,
    content_disposition,
    content_encoding,
    content_language,
    metadata,
    cache_control
  );
  const partitionsRangeArray = calculatePartitionsRangeArray(object_size, copy_part_size_bytes);
  const copyPartFunctionsArray = [];

  partitionsRangeArray.forEach((partitionRange, index) => {
    copyPartFunctionsArray.push(
      copyPart(
        deps,
        source_bucket,
        destination_bucket,
        index + 1,
        object_key,
        partitionRange,
        copied_object_name,
        upload_id
      )
    );
  });

  return Promise.all(copyPartFunctionsArray)
    .then((copy_results) => {
      log.info({ msg: `copied all parts successfully: ${JSON.stringify(copy_results)}`, context: request_context });

      const copyResultsForCopyCompletion = prepareResultsForCopyCompletion(copy_results);
      return completeMultipartCopy(
        deps,
        destination_bucket,
        copyResultsForCopyCompletion,
        copied_object_name,
        upload_id,
        request_context
      );
    })
    .catch((err) => {
      log.error(err);
      return abortMultipartCopy(deps, destination_bucket, copied_object_name, upload_id, request_context);
    });
}

function initiateMultipartCopy(
  deps,
  destination_bucket,
  copied_object_name,
  copied_object_permissions,
  expiration_period,
  request_context,
  server_side_encryption,
  content_type,
  content_disposition,
  content_encoding,
  content_language,
  metadata,
  cache_control
) {
  const { log, s3CreateMultipartUpload } = deps;
  const params = {
    Bucket: destination_bucket,
    Key: copied_object_name,
    ACL: copied_object_permissions || DEFAULT_COPIED_OBJECT_PERMISSIONS,
  };
  expiration_period ? (params.Expires = expiration_period) : null;
  content_type ? (params.ContentType = content_type) : null;
  content_disposition ? (params.ContentDisposition = content_disposition) : null;
  content_encoding ? (params.ContentEncoding = content_encoding) : null;
  content_language ? (params.ContentLanguage = content_language) : null;
  metadata ? (params.Metadata = metadata) : null;
  cache_control ? (params.CacheControl = cache_control) : null;
  server_side_encryption ? (params.ServerSideEncryption = server_side_encryption) : null;

  return s3CreateMultipartUpload(params)
    .then((result) => {
      log.info({
        msg: `multipart copy initiated successfully: ${JSON.stringify(result)}`,
        context: request_context,
      });
      return Promise.resolve(result.UploadId);
    })
    .catch((err) => {
      log.error({ msg: "multipart copy failed to initiate", context: request_context, error: err });
      return Promise.reject(err);
    });
}

function copyPart(
  deps,
  source_bucket,
  destination_bucket,
  part_number,
  object_key,
  partition_range,
  copied_object_name,
  upload_id
) {
  const encodedSourceKey = encodeURIComponent(`${source_bucket}/${object_key}`);
  const { log, s3UploadPartCopy } = deps;
  const params = {
    Bucket: destination_bucket,
    CopySource: encodedSourceKey,
    CopySourceRange: "bytes=" + partition_range,
    Key: copied_object_name,
    PartNumber: part_number,
    UploadId: upload_id,
  };

  return s3UploadPartCopy(params)
    .then((result) => {
      log.info({ msg: `CopyPart ${part_number} succeeded: ${JSON.stringify(result)}` });
      return Promise.resolve(result);
    })
    .catch((err) => {
      log.error({ msg: `CopyPart ${part_number} Failed: ${JSON.stringify(err)}`, error: err });
      return Promise.reject(err);
    });
}

function abortMultipartCopy(deps, destination_bucket, copied_object_name, upload_id, request_context) {
  const { log, s3AbortMultipartUpload, s3ListParts } = deps;
  const params = {
    Bucket: destination_bucket,
    Key: copied_object_name,
    UploadId: upload_id,
  };

  return s3AbortMultipartUpload(params)
    .then(() => {
      return s3ListParts(params);
    })
    .catch((err) => {
      log.error({ msg: "abort multipart copy failed", context: request_context, error: err });

      return Promise.reject(err);
    })
    .then((parts_list) => {
      if (parts_list.Parts.length > 0) {
        const err = new Error("Abort procedure passed but copy parts were not removed");
        err.details = parts_list;

        log.error({
          msg: "abort multipart copy failed, copy parts were not removed",
          context: request_context,
          error: err,
        });

        return Promise.reject(err);
      } else {
        log.info({
          msg: `multipart copy aborted successfully: ${JSON.stringify(parts_list)}`,
          context: request_context,
        });

        const err = new Error("multipart copy aborted");
        err.details = params;

        return Promise.reject(err);
      }
    });
}

function completeMultipartCopy(deps, destination_bucket, ETags_array, copied_object_name, upload_id, request_context) {
  const { log, s3CompleteMultipartUpload } = deps;
  const params = {
    Bucket: destination_bucket,
    Key: copied_object_name,
    MultipartUpload: {
      Parts: ETags_array,
    },
    UploadId: upload_id,
  };

  return s3CompleteMultipartUpload(params)
    .then((result) => {
      log.info({
        msg: `multipart copy completed successfully: ${JSON.stringify(result)}`,
        context: request_context,
      });
      return Promise.resolve(result);
    })
    .catch((err) => {
      log.error({ msg: "Multipart upload failed", context: request_context, error: err });
      return Promise.reject(err);
    });
}

function calculatePartitionsRangeArray(object_size, copy_part_size_bytes) {
  const partitions = [];
  const copy_part_size = copy_part_size_bytes || DEFAULT_COPY_PART_SIZE_BYTES;
  const numOfPartitions = Math.floor(object_size / copy_part_size);
  const remainder = object_size % copy_part_size;
  let index, partition;

  for (index = 0; index < numOfPartitions; index++) {
    const nextIndex = index + 1;
    if (nextIndex === numOfPartitions && remainder < COPY_PART_SIZE_MINIMUM_BYTES) {
      partition = index * copy_part_size + "-" + (nextIndex * copy_part_size + remainder - 1);
    } else {
      partition = index * copy_part_size + "-" + (nextIndex * copy_part_size - 1);
    }
    partitions.push(partition);
  }

  if (remainder >= COPY_PART_SIZE_MINIMUM_BYTES) {
    partition = index * copy_part_size + "-" + (index * copy_part_size + remainder - 1);
    partitions.push(partition);
  }

  return partitions;
}

function prepareResultsForCopyCompletion(copy_parts_results_array) {
  const resultArray = [];

  copy_parts_results_array.forEach((copy_part, index) => {
    const newCopyPart = {};
    newCopyPart.ETag = copy_part.CopyPartResult.ETag;
    newCopyPart.PartNumber = index + 1;
    resultArray.push(newCopyPart);
  });

  return resultArray;
}

module.exports = {
  createDeps,
  copyObjectMultipart,
};
