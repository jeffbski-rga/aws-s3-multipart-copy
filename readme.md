# @jeffbski-rga/aws-s3-multipart-copy

Fork of aws-s3-multipart-copy to fix issues with broken dependencies from snyk

Wraps [aws-sdk](https://www.npmjs.com/package/aws-sdk) with a multipart-copy manager, in order to provide an easy way to copy large objects from one bucket to another in aws-s3.
The module manages the copy parts order and bytes range according to the size of the object and the desired copy part size. It speeds up the multipart copying process by sending multiple copy-part requests simultaneously.

\*\* The package supports aws-sdk version '2006-03-01' and above.

\*\* The package supports node 8 version and above.

[![Travis CI](https://travis-ci.org/jeffbski-rga/aws-s3-multipart-copy.svg?branch=master)](https://travis-ci.org/jeffbski-rga/aws-s3-multipart-copy)

## Installing

```
npm install @jeffbski-rga/aws-s3-multipart-copy
```

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
<!--**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*-->

- [@jeffbski-rga/aws-s3-multipart-copy](#jeffbski-rgaaws-s3-multipart-copy)
  - [Installing](#installing)
  - [createDeps](#createdeps)
    - [Example](#example)
  - [copyObjectMultipart](#copyobjectmultipart)
    - [Request parameters](#request-parameters)
    - [Response](#response)
    - [Example](#example-1)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## createDeps

aws-s3-multipart-copy is based on the aws-sdk and requires a log object, so createDeps creates a flattened dependcy object with a `log` and async fns that perform s3 commands.

Also, it requires a log instance which supports 'info' and 'error' level of logging (meaning logger.info and logger.error are functions).

If resilience is desired then these s3 functions can be wrapped to retry on certain types of errors.

```js
const deps = createDeps(s3, log);
/*
{
  log,
  s3CreateMultipartUpload,
  s3UploadPartCopy,
  s3AbortMultipartUpload,
  s3ListParts,
  s3CompleteMultipartUpload
}
```

### Example

```js
const bunyan = require('bunyan'),
    AWS = require('aws-sdk');
const {createDeps, copyObjectMultipart} = require('@jeffbski-rga/aws-s3-multipart-copy');

const log = bunyan.createLogger({
        name: 'copy-object-multipart',
        level: 'info',
        version: 1.0.0,
        logType: 'copy-object-multipart-log',
        serializers: { err: bunyan.stdSerializers.err }
    });

const s3 = new AWS.S3();
const deps = createDeps(s3, log);
```

## copyObjectMultipart

After module is initialized, the copyObjectMultipart functionality is ready for usage.
copyObjectMultipart returns a promise and can only copy (and not upload) objects from bucket to bucket.

\*\* Objects size for multipart copy must be at least 5MB.

The method receives two parameters: options and request_context

### Request parameters

- deps: Object(mandatory) - moduleDeps log and async fns that perform s3 commands
- options: Object (mandatory) - keys inside this object must be as specified below
  - source_bucket: String (mandatory) - The bucket that holds the object you wish to copy
  - object_key: String (mandatory) - The full path (including the name of the object) to the object you wish to copy
  - destination_bucket: String (mandatory) - The bucket that you wish to copy to
  - copied_object_name: String (mandatory) - The full path (including the name of the object) for the copied object in the destination bucket
  - object_size: Integer (mandatory) - A number indicating the size of the object you wish to copy in bytes
  - copy_part_size_bytes: Integer (optional) - A number indicating the size of each copy part in the process, if not passed it will be set to a default of 50MB. This value must be between 5MB and 5GB - 5MB.
    \*\* if object size does not divide exactly with the part size desired, last part will be smaller or larger (depending on remainder size)
  - copied_object_permissions: String (optional) - The permissions to be given for the copied object as specified in [aws s3 ACL docs](https://docs.aws.amazon.com/AmazonS3/latest/dev/acl-overview.html#permissions), if not passed it will be set to a default of 'private'
  - expiration_period: Integer/Date (optional) - A number (milliseconds) or Date indicating the time the copied object will remain in the destination before it will be deleted, if not passed there will be no expiration period for the object
  - content_type: String (optional) A standard MIME type describing the format of the object data
  - metadata: Object (optional) - A map of metadata to store with the object in S3
  - cache_control: String (optional) - Specifies caching behavior along the request/reply chain
- request_context: String (optional) - this parameter will be logged in every log message, if not passed it will remain undefined.

### Response

- A successful result might hold any of the following keys as specified in [aws s3 completeMultipartUpload docs](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#completeMultipartUpload-property)

  - Location — (String)
  - Bucket — (String)
  - Key — (String)
  - Expiration — (String) If the object expiration is configured, this will contain the expiration date (expiry-date) and rule ID (rule-id). The value of rule-id is URL encoded.
  - ETag — (String) Entity tag of the object.
  - ServerSideEncryption — (String) The Server-side encryption algorithm used when storing this object in S3 (e.g., AES256, aws:kms). Possible values include:
    - "AES256"
    - "aws:kms"
  - VersionId — (String) Version of the object.
  - SSEKMSKeyId — (String) If present, specifies the ID of the AWS Key Management Service (KMS) master encryption key that was used for the object.
  - RequestCharged — (String) If present, indicates that the requester was successfully charged for the request. Possible values include:
    - "requester"

- In case multipart copy fails, three scenarios are possible:
  - The copy will be aborted and copy parts will be deleted from s3 - copyObjectMultipart will reject
  - The abort procedure passed but the copy parts were not deleted from s3 - copyObjectMultipart will reject
  - The abort procedure fails and the copy parts will remain in s3 - copyObjectMultipart will reject

### Example

Positive

```js
const { createDeps, copyObjectMultipart } = require("@jeffbski-rga/aws-s3-multipart-copy");
const request_context = "request_context";
const options = {
  source_bucket: "source_bucket",
  object_key: "object_key",
  destination_bucket: "destination_bucket",
  copied_object_name: "someLogicFolder/copied_object_name",
  object_size: 70000000,
  copy_part_size_bytes: 50000000,
  copied_object_permissions: "bucket-owner-full-control",
  expiration_period: 100000,
};
const deps = createDeps(s3, log);

return copyObjectMultipart(deps, options, request_context)
  .then((result) => {
    console.log(result);
  })
  .catch((err) => {
    // handle error
  });

/* Response:
            result = {
                Bucket: "acexamplebucket", 
                ETag: "\"4d9031c7644d8081c2829f4ea23c55f7-2\"", 
                Expiration: 100000,
                Key: "bigobject", 
                Location: "https://examplebucket.s3.amazonaws.com/bigobject"
            }
        */
```

Negative 1 - abort action passed but copy parts were not removed

```js
const { createDeps, copyObjectMultipart } = require("@jeffbski-rga/aws-s3-multipart-copy");
const request_context = "request_context";
const options = {
  source_bucket: "source_bucket",
  object_key: "object_key",
  destination_bucket: "destination_bucket",
  copied_object_name: "someLogicFolder/copied_object_name",
  object_size: 70000000,
  copy_part_size_bytes: 50000000,
  copied_object_permissions: "bucket-owner-full-control",
  expiration_period: 100000,
};
const deps = createDeps(s3, log);

return copyObjectMultipart(deps, options, request_context)
  .then((result) => {
    // handle result
  })
  .catch((err) => {
    console.log(err);
  });

/*
            err = {
                message: 'Abort procedure passed but copy parts were not removed'
                details: {
                    Parts: ['part 1', 'part 2']
                    }
                }
        */
```

Negative 2 - abort action succeded

```js
const { createDeps, copyObjectMultipart } = require("@jeffbski-rga/aws-s3-multipart-copy");
const request_context = "request_context";
const options = {
  source_bucket: "source_bucket",
  object_key: "object_key",
  destination_bucket: "destination_bucket",
  copied_object_name: "someLogicFolder/copied_object_name",
  object_size: 70000000,
  copy_part_size_bytes: 50000000,
  copied_object_permissions: "bucket-owner-full-control",
  expiration_period: 100000,
};
const deps = createDeps(s3, log);

return copyObjectMultipart(deps, options, request_context)
  .then((result) => {
    // handle result
  })
  .catch((err) => {
    console.log(err);
  });

/*
            err = {
                    message: 'multipart copy aborted',
                    details: {
                        Bucket: destination_bucket,
                        Key: copied_object_name,
                        UploadId: upload_id
                    }
                }
        */
```
