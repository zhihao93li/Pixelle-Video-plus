import { useMemo, useState } from "react"
import { Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { apiResourceUrl, type ResourceTemplate } from "@/lib/generationApi"
import { frameTemplateLabel } from "@/lib/templateLabels"
import { cn } from "@/lib/utils"

/**
 * 画面模板图选网格（批次三 PRD WP-A）：预览图直接当选择器，点图即选。
 * inline 渲染（弹层白名单锁定，禁止做成 Dialog/Sheet）；无预览图的模板显示名字卡。
 * 三处共用：生成页「每镜画面」、配方详情页 frame_template 零件、出片面板专家覆盖。
 */

const ORIENTATION_LABELS: Record<string, string> = {
  portrait: "竖版",
  landscape: "横版",
  square: "方形",
}

const INITIAL_VISIBLE = 12

export function FrameTemplatePicker({
  templates,
  value,
  onChange,
  allowDefault = false,
  defaultLabel = "配方默认",
}: {
  templates: ResourceTemplate[]
  /** 当前选中模板 key；allowDefault 场景下空串表示「跟随配方默认」。 */
  value: string
  onChange: (key: string) => void
  /** 顶部加一张「配方默认」卡（出片面板覆盖场景），选中回传空串。 */
  allowDefault?: boolean
  defaultLabel?: string
}) {
  const selected = templates.find((item) => item.key === value)
  const [orientation, setOrientation] = useState(
    () => selected?.orientation || "portrait"
  )
  const [showAll, setShowAll] = useState(false)

  const orientationOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of templates) {
      counts.set(item.orientation, (counts.get(item.orientation) || 0) + 1)
    }
    return Object.keys(ORIENTATION_LABELS)
      .filter((key) => counts.has(key))
      .map((key) => ({ key, count: counts.get(key) || 0 }))
  }, [templates])

  const filtered = useMemo(() => {
    const inOrientation = templates.filter(
      (item) => item.orientation === orientation
    )
    // 选中项不在当前方向时置顶显示，避免"选中的被藏起来"
    if (selected && selected.orientation !== orientation) {
      return [selected, ...inOrientation]
    }
    return inOrientation
  }, [templates, orientation, selected])

  const visible = showAll ? filtered : filtered.slice(0, INITIAL_VISIBLE)
  const hiddenCount = filtered.length - visible.length

  return (
    <div className="flex flex-col gap-2">
      {orientationOptions.length > 1 && (
        <ToggleGroup
          onValueChange={(next) => {
            if (next) {
              setOrientation(next)
              setShowAll(false)
            }
          }}
          size="sm"
          type="single"
          value={orientation}
          variant="outline"
        >
          {orientationOptions.map((option) => (
            <ToggleGroupItem key={option.key} value={option.key}>
              {ORIENTATION_LABELS[option.key]} {option.count}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
        {allowDefault && (
          <PickerCard
            aspect="9 / 16"
            label={defaultLabel}
            onClick={() => onChange("")}
            selected={!value}
          >
            <div className="flex h-full items-center justify-center bg-muted/40 p-1 text-center text-xs text-muted-foreground">
              {defaultLabel}
            </div>
          </PickerCard>
        )}
        {visible.map((item) => {
          const previewSrc = apiResourceUrl(item.preview_url)
          const label = frameTemplateLabel(item.key)
          return (
            <PickerCard
              aspect={`${item.width} / ${item.height}`}
              key={item.key}
              label={label}
              onClick={() => onChange(item.key)}
              selected={item.key === value}
            >
              {previewSrc ? (
                <img
                  alt={`${label}模板预览`}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  src={previewSrc}
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-muted/40 p-1 text-center text-xs text-muted-foreground">
                  {label}
                </div>
              )}
            </PickerCard>
          )
        })}
      </div>

      {hiddenCount > 0 && (
        <Button
          className="self-start"
          onClick={() => setShowAll(true)}
          size="sm"
          type="button"
          variant="ghost"
        >
          显示全部 {filtered.length} 个
        </Button>
      )}
    </div>
  )
}

function PickerCard({
  selected,
  label,
  aspect,
  onClick,
  children,
}: {
  selected: boolean
  label: string
  aspect: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "relative flex flex-col rounded-lg border p-1 text-left transition-colors",
        selected
          ? "border-primary ring-1 ring-primary"
          : "hover:border-input hover:bg-muted/40"
      )}
      onClick={onClick}
      type="button"
    >
      <div
        className="w-full overflow-hidden rounded-md"
        style={{ aspectRatio: aspect }}
      >
        {children}
      </div>
      <span
        className={cn(
          "mt-1 w-full truncate text-center text-xs",
          selected ? "font-medium" : "text-muted-foreground"
        )}
      >
        {label}
      </span>
      {selected && (
        <span className="absolute right-1.5 top-1.5 rounded-full bg-primary p-0.5 text-primary-foreground">
          <Check className="size-3" />
        </span>
      )}
    </button>
  )
}
