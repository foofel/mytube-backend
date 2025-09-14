import { Upload } from 'tus-js-client'
import fs from 'fs';

const path = `/home/foofel/camera/2025_08_15_nordwandhalle_session1/prores_out/P1000199_prores.mov`
const file = fs.createReadStream(path)

// interface UploadOptions {
//   endpoint?: string | null

//   uploadUrl?: string | null
//   metadata?: { [key: string]: string }
//   metadataForPartialUploads?: { [key: string]: string }
//   fingerprint?: (file: File, options: UploadOptions) => Promise<string>
//   uploadSize?: number | null

//   onProgress?: ((bytesSent: number, bytesTotal: number) => void) | null
//   onChunkComplete?: ((chunkSize: number, bytesAccepted: number, bytesTotal: number) => void) | null
//   onSuccess?: ((payload: OnSuccessPayload) => void) | null
//   onError?: ((error: Error | DetailedError) => void) | null
//   onShouldRetry?:
//     | ((error: DetailedError, retryAttempt: number, options: UploadOptions) => boolean)
//     | null
//   onUploadUrlAvailable?: (() => void) | null

//   overridePatchMethod?: boolean
//   headers?: { [key: string]: string }
//   addRequestId?: boolean
//   onBeforeRequest?: (req: HttpRequest) => void | Promise<void>
//   onAfterResponse?: (req: HttpRequest, res: HttpResponse) => void | Promise<void>

//   chunkSize?: number
//   retryDelays?: number[] | null
//   parallelUploads?: number
//   parallelUploadBoundaries?: { start: number; end: number }[] | null
//   storeFingerprintForResuming?: boolean
//   removeFingerprintOnSuccess?: boolean
//   uploadLengthDeferred?: boolean
//   uploadDataDuringCreation?: boolean

//   urlStorage?: UrlStorage
//   fileReader?: FileReader
//   httpStack?: HttpStack
// }

const options = {
  endpoint: 'http://localhost:6989/files/',
  chunkSize: 1024*1024,
  metadata: {
    filename: 'README.md',
    filetype: 'text/plain',
  },
  onError(error) {
    console.error('An error occurred:')
    console.error(error)
    process.exitCode = 1
  },
  onProgress(bytesUploaded, bytesTotal) {
    const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2)
    console.log(bytesUploaded, bytesTotal, `${percentage}%`)
  },
  onSuccess() {
    console.log('Upload finished:', upload.url)
  },
}

const upload = new Upload(file, options)
upload.start()