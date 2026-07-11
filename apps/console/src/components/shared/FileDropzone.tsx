import { useRef, useState } from "react"
import { UploadCloud, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatBytes } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * 统一文件上传控件：点击或拖拽选择，多文件列表，单文件移除。
 * 见 DESIGN.md「文件上传」。
 */
export function FileDropzone({
  accept,
  files,
  hint,
  id,
  multiple = true,
  onFilesChange,
}: {
  accept: string
  files: File[]
  hint?: string
  id: string
  multiple?: boolean
  onFilesChange: (files: File[]) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  function addFiles(incoming: File[]) {
    if (incoming.length === 0) {
      return
    }
    if (!multiple) {
      onFilesChange(incoming.slice(0, 1))
      return
    }
    const merged = [...files]
    for (const file of incoming) {
      const duplicate = merged.some(
        (existing) =>
          existing.name === file.name &&
          existing.size === file.size &&
          existing.lastModified === file.lastModified
      )
      if (!duplicate) {
        merged.push(file)
      }
    }
    onFilesChange(merged)
  }

  function removeFile(target: File) {
    onFilesChange(files.filter((file) => file !== target))
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        aria-label="选择或拖拽文件"
        className={cn(
          "flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5",
          isDragging && "border-primary bg-primary/5 text-primary"
        )}
        onClick={() => inputRef.current?.click()}
        onDragLeave={() => setIsDragging(false)}
        onDragOver={(event) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragging(false)
          addFiles(Array.from(event.dataTransfer.files ?? []))
        }}
        type="button"
      >
        <UploadCloud className="size-5" />
        <span>点击选择文件，或拖拽到这里</span>
        {hint && <span className="text-xs">{hint}</span>}
      </button>
      <input
        accept={accept}
        className="hidden"
        id={id}
        multiple={multiple}
        onChange={(event) => {
          addFiles(Array.from(event.currentTarget.files ?? []))
          event.currentTarget.value = ""
        }}
        ref={inputRef}
        type="file"
      />

      {files.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {files.map((file) => (
            <div
              className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 text-sm"
              key={`${file.name}-${file.size}-${file.lastModified}`}
            >
              <span className="min-w-0 truncate">{file.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {formatBytes(file.size)}
                </span>
                <Button
                  aria-label={`移除 ${file.name}`}
                  onClick={() => removeFile(file)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <X />
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
