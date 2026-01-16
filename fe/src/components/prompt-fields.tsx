"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function PromptFields({
  positivePrompt,
  negativePrompt,
  onPositiveChange,
  onNegativeChange,
  disabled,
}: {
  positivePrompt: string;
  negativePrompt: string;
  onPositiveChange: (value: string) => void;
  onNegativeChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="positivePrompt">Positive prompt</Label>
        <Textarea
          id="positivePrompt"
          placeholder="Positive prompt..."
          value={positivePrompt}
          onChange={(e) => onPositiveChange(e.target.value)}
          rows={5}
          disabled={disabled}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="negativePrompt">Negative prompt</Label>
        <Textarea
          id="negativePrompt"
          placeholder="Negative prompt..."
          value={negativePrompt}
          onChange={(e) => onNegativeChange(e.target.value)}
          rows={3}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
