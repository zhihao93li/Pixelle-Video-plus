import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { artifactKindLabel, templateArtifactType } from "@/lib/artifactKind"
import type { ProductionTemplate } from "@/lib/generationApi"

/**
 * 全站统一的「在生产点选配方」下拉：配方名 + 形态徽标（视频/图集/长文）。
 * 调用方负责过滤可选项（只传启用、非退役、对应入口的配方）——组件只管「选」。
 * 出片面板与生成页页头共用，样式/行为改一处两处生效。
 */
export function RecipeSelect({
  templates,
  value,
  onChange,
  triggerClassName,
  placeholder = "选择生产配方",
}: {
  templates: ProductionTemplate[]
  value: string
  onChange: (template: ProductionTemplate) => void
  triggerClassName?: string
  placeholder?: string
}) {
  return (
    <Select
      onValueChange={(id) => {
        const next = templates.find((template) => template.id === id)
        if (next) {
          onChange(next)
        }
      }}
      value={value}
    >
      <SelectTrigger className={triggerClassName ?? "w-full"}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {templates.map((template) => (
          <SelectItem key={template.id} value={template.id}>
            {template.display_name}
            <span className="ml-1.5 text-xs text-muted-foreground">
              · {artifactKindLabel(templateArtifactType(template.pipeline_id))}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
