import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type FileError, type FileRejection, useDropzone } from 'react-dropzone'
import {type SupabaseClient} from '@supabase/supabase-js'
import { toast } from 'sonner'

interface FileWithPreview extends File {
  preview?: string
  errors: readonly FileError[]
}

type UseSupabaseUploadOptions = {
  /**
   * Name of bucket to upload files to in your Supabase project
   */
  bucketName: string
  /**
   * Folder to upload files to in the specified bucket within your Supabase project.
   *
   * Defaults to uploading files to the root of the bucket
   *
   * e.g If specified path is `test`, your file will be uploaded as `test/file_name`
   */
  path?: string
  /**
   * Allowed MIME types for each file upload (e.g `image/png`, `text/html`, etc). Wildcards are also supported (e.g `image/*`).
   *
   * Defaults to allowing uploading of all MIME types.
   */
  allowedMimeTypes?: string[]
  /**
   * Maximum upload size of each file allowed in bytes. (e.g 1000 bytes = 1 KB)
   */
  maxFileSize?: number
  /**
   * Maximum number of files allowed per upload.
   */
  maxFiles?: number
  /**
   * The number of seconds the asset is cached in the browser and in the Supabase CDN.
   *
   * This is set in the Cache-Control: max-age=<seconds> header. Defaults to 3600 seconds.
   */
  cacheControl?: number
  /**
   * When set to true, the file is overwritten if it exists.
   *
   * When set to false, an error is thrown if the object already exists. Defaults to `false`
   */
  upsert?: boolean

  /**
   * initialized Supabase client instance
   */
  supabase: SupabaseClient
}

type UseSupabaseUploadReturn = ReturnType<typeof useSupabaseUpload>

const useSupabaseUpload = (options: UseSupabaseUploadOptions) => {
  const {
    bucketName,
    path,
    allowedMimeTypes = [],
    maxFileSize = Number.POSITIVE_INFINITY,
    maxFiles = 1,
    cacheControl = 3600,
    upsert = false,
    supabase
  } = options

  const [files, setFiles] = useState<FileWithPreview[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [errors, setErrors] = useState<{ name: string; message: string }[]>([])
  const [successes, setSuccesses] = useState<string[]>([])
  const previewUrls = useRef(new Set<string>())

  useEffect(() => () => {
    previewUrls.current.forEach((preview) => URL.revokeObjectURL(preview))
    previewUrls.current.clear()
  }, [])

  useEffect(() => {
    const activePreviews = new Set(files.map((file) => file.preview))
    previewUrls.current.forEach((preview) => {
      if (!activePreviews.has(preview)) {
        URL.revokeObjectURL(preview)
        previewUrls.current.delete(preview)
      }
    })
  }, [files])

  const isSuccess = useMemo(() => {
    if (errors.length === 0 && successes.length === 0) {
      return false
    }
    if (errors.length === 0 && successes.length === files.length) {
      return true
    }
    return false
  }, [errors.length, successes.length, files.length])

  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      const createPreview = (file: File, fileErrors: readonly FileError[] = []) => {
        const preview = URL.createObjectURL(file)
        previewUrls.current.add(preview)
        return Object.assign(file, { preview, errors: fileErrors })
      }
      const incomingFiles = [
        ...acceptedFiles.map((file) => createPreview(file)),
        ...fileRejections.map(({ file, errors }) => createPreview(file, errors)),
      ]

      setFiles((currentFiles) => {
        const existingNames = new Set(currentFiles.map((file) => file.name))
        return [...currentFiles, ...incomingFiles.filter((file) => !existingNames.has(file.name))]
      })
    },
    []
  )

  const dropzoneProps = useDropzone({
    onDrop,
    noClick: true,
    accept: allowedMimeTypes.reduce((acc, type) => ({ ...acc, [type]: [] }), {}),
    maxSize: maxFileSize,
    maxFiles: maxFiles,
    multiple: maxFiles !== 1,
  })

  const onUpload = useCallback(async () => {
    const filesToUpload = files.filter((file) => !successes.includes(file.name))
    if (filesToUpload.length === 0) return

    const toastId = toast.loading(`Uploading ${filesToUpload.length} file${filesToUpload.length === 1 ? '' : 's'}...`)
    setLoading(true)
    try {
      const responses = await Promise.all(
        filesToUpload.map(async (file) => {
          try {
            const { error } = await supabase.storage
              .from(bucketName)
              .upload(path ? `${path}/${file.name}` : file.name, file, {
                cacheControl: cacheControl.toString(),
                upsert,
              })
            return error
              ? { name: file.name, message: error.message }
              : { name: file.name, message: undefined }
          } catch (error) {
            return {
              name: file.name,
              message: error instanceof Error ? error.message : 'Unexpected upload error',
            }
          }
        })
      )

      setErrors(responses.filter((response) => response.message !== undefined))
      setSuccesses((current) => Array.from(new Set([
        ...current,
        ...responses.filter((response) => response.message === undefined).map((response) => response.name),
      ])))
      const failureCount = responses.filter((response) => response.message !== undefined).length
      const successCount = responses.length - failureCount
      if (failureCount === 0) {
        toast.success(`Uploaded ${successCount} file${successCount === 1 ? '' : 's'}.`, { id: toastId })
      } else {
        toast.error(`${failureCount} file${failureCount === 1 ? '' : 's'} failed to upload.`, { id: toastId })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected upload error'
      toast.error(message, { id: toastId })
    } finally {
      setLoading(false)
    }
  }, [files, path, bucketName, cacheControl, upsert, supabase, successes])

  useEffect(() => {
    if (files.length === 0) {
      setErrors([])
    }

    // If the number of files doesn't exceed the maxFiles parameter, remove the error 'Too many files' from each file
    if (files.length <= maxFiles) {
      let changed = false
      const newFiles = files.map((file) => {
        if (file.errors.some((e) => e.code === 'too-many-files')) {
          file.errors = file.errors.filter((e) => e.code !== 'too-many-files')
          changed = true
        }
        return file
      })
      if (changed) {
        setFiles(newFiles)
      }
    }
  }, [files.length, setFiles, maxFiles])

  return {
    files,
    setFiles,
    successes,
    isSuccess,
    loading,
    errors,
    setErrors,
    onUpload,
    maxFileSize: maxFileSize,
    maxFiles: maxFiles,
    allowedMimeTypes,
    ...dropzoneProps,
  }
}

export { useSupabaseUpload, type UseSupabaseUploadOptions, type UseSupabaseUploadReturn }
