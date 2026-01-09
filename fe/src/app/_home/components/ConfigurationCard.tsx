"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Check, ChevronsUpDown, Loader2, Trash2, X } from "lucide-react";

import type { BusyState, CatalogItem, SetLora } from "@/app/_home/types";
import { basename, parseTriggerWords } from "@/app/_home/utils";

type Props = {
  busy: BusyState;

  currentModelPath: string;
  currentModelLabel: string;
  currentLoras: SetLora[];

  modelGroups: Map<string, CatalogItem[]>;
  selectedModelPath: string;
  selectedModelLabel: string;
  modelPickerOpen: boolean;
  onModelPickerOpenChange: (open: boolean) => void;
  onSelectModel: (modelPath: string) => void;
  onApplyModel: () => void;
  onClearModel: () => void;

  loraGroups: Map<string, CatalogItem[]>;
  selectedLoras: Record<string, number>;
  onSelectedLoras: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  selectedLoraCount: number;
  loraPickerOpen: boolean;
  onLoraPickerOpenChange: (open: boolean) => void;
  onApplyLoras: () => void;
  onClearLoras: () => void;

  onCopyToClipboard: (text: string) => void | Promise<void>;
};

export function ConfigurationCard({
  busy,
  currentModelPath,
  currentModelLabel,
  currentLoras,
  modelGroups,
  selectedModelPath,
  selectedModelLabel,
  modelPickerOpen,
  onModelPickerOpenChange,
  onSelectModel,
  onApplyModel,
  onClearModel,
  loraGroups,
  selectedLoras,
  onSelectedLoras,
  selectedLoraCount,
  loraPickerOpen,
  onLoraPickerOpenChange,
  onApplyLoras,
  onClearLoras,
  onCopyToClipboard,
}: Props) {
  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader className="space-y-2">
        <CardTitle>Configuration</CardTitle>
        <CardDescription>Browse folders, apply a model, then layer LoRAs with clear feedback.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border bg-muted/40 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={currentModelPath ? "secondary" : "outline"} title={currentModelPath || ""}>
              {currentModelPath ? `Model: ${currentModelLabel}` : "Model: none"}
            </Badge>
            <Badge variant="outline">{currentLoras.length} LoRAs applied</Badge>
            <Badge variant="outline">{selectedLoraCount} selected</Badge>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">Select model</div>
              <p className="text-xs text-muted-foreground">Pick a base before applying LoRAs.</p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" disabled={busy !== null || !currentModelPath} className="gap-1">
                  <Trash2 className="size-4" />
                  Clear model
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear current model?</AlertDialogTitle>
                  <AlertDialogDescription>This unloads the model and clears all applied LoRAs in the Python worker.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onClearModel}>Clear</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <Popover open={modelPickerOpen} onOpenChange={onModelPickerOpenChange}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={modelPickerOpen}
                className="w-full justify-between"
                disabled={busy !== null}
              >
                {selectedModelPath ? selectedModelLabel : "Choose a model..."}
                <ChevronsUpDown className="opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
              <Command>
                <CommandInput placeholder="Search models..." />
                <CommandEmpty>No models found.</CommandEmpty>
                <CommandList>
                  {[...modelGroups.entries()].map(([group, items]) => (
                    <CommandGroup key={group} heading={group}>
                      {items.map((item) => (
                        <CommandItem
                          key={item.fullPath}
                          value={`${group}/${item.name}`}
                          onSelect={() => {
                            onSelectModel(item.fullPath);
                            onModelPickerOpenChange(false);
                          }}
                        >
                          <Check className={selectedModelPath === item.fullPath ? "mr-2 size-4 opacity-100" : "mr-2 size-4 opacity-0"} />
                          <span className="truncate">{item.name}</span>
                          {currentModelPath === item.fullPath && (
                            <Badge variant="secondary" className="ml-auto">
                              Applied
                            </Badge>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onApplyModel} disabled={!selectedModelPath || busy !== null}>
              {busy === "setModel" ? <Loader2 className="animate-spin" /> : null}
              Apply model
            </Button>
            <p className="text-xs text-muted-foreground">Applied models clear any previously loaded LoRAs.</p>
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">LoRAs</div>
              <p className="text-xs text-muted-foreground">Select multiple, adjust their weights, then apply.</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{currentLoras.length} applied</Badge>
              <Badge variant="outline">{selectedLoraCount} selected</Badge>
            </div>
          </div>

          <Popover open={loraPickerOpen} onOpenChange={onLoraPickerOpenChange}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-between" disabled={busy !== null}>
                Add LoRA...
                <ChevronsUpDown className="opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
              <Command>
                <CommandInput placeholder="Search LoRAs..." />
                <CommandEmpty>No LoRAs found.</CommandEmpty>
                <CommandList>
                  {[...loraGroups.entries()].map(([group, items]) => (
                    <CommandGroup key={group} heading={group}>
                      {items.map((item) => (
                        <CommandItem
                          key={item.fullPath}
                          value={`${group}/${item.name}`}
                          onSelect={() => {
                            onSelectedLoras((prev) => {
                              if (Object.prototype.hasOwnProperty.call(prev, item.fullPath)) return prev;
                              return { ...prev, [item.fullPath]: 1.0 };
                            });
                            onLoraPickerOpenChange(false);
                          }}
                        >
                          <Check
                            className={
                              Object.prototype.hasOwnProperty.call(selectedLoras, item.fullPath)
                                ? "mr-2 size-4 opacity-100"
                                : "mr-2 size-4 opacity-0"
                            }
                          />
                          <span className="truncate">{item.name}</span>
                          {currentLoras.some((l) => l.path === item.fullPath) && (
                            <Badge variant="secondary" className="ml-auto">
                              Applied
                            </Badge>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <div className="overflow-hidden rounded-lg border">
            <ScrollArea className="h-60 w-full">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/2">Name</TableHead>
                    <TableHead className="w-[160px] text-right">Weight</TableHead>
                    <TableHead className="w-[110px]">State</TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedLoraCount === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-muted-foreground">
                        No LoRAs selected.
                      </TableCell>
                    </TableRow>
                  ) : (
                    Object.entries(selectedLoras)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([path, weight]) => {
                        const name = basename(path);
                        const isApplied = currentLoras.some((l) => l.path === path);
                        return (
                          <TableRow key={path}>
                            <TableCell className="min-w-0">
                              <div className="truncate font-medium" title={path}>
                                {name}
                              </div>
                              <p className="text-xs text-muted-foreground">{path}</p>
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                inputMode="decimal"
                                min={0.1}
                                step={0.1}
                                value={weight}
                                className="h-10 w-full min-w-[150px] font-mono text-right"
                                onChange={(e) => {
                                  const next = Number(e.target.value);
                                  onSelectedLoras((prev) => ({
                                    ...prev,
                                    [path]: Number.isFinite(next) ? Math.max(0.1, next) : 1.0,
                                  }));
                                }}
                              />
                            </TableCell>
                            <TableCell>{isApplied ? <Badge variant="secondary">Applied</Badge> : <Badge variant="outline">Selected</Badge>}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  onSelectedLoras((prev) => {
                                    const next = { ...prev };
                                    delete next[path];
                                    return next;
                                  });
                                }}
                                disabled={busy !== null}
                                aria-label={`Remove ${name}`}
                              >
                                <X />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                  )}
                </TableBody>
              </Table>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onApplyLoras} disabled={busy !== null || selectedLoraCount === 0}>
              {busy === "setLoras" ? <Loader2 className="animate-spin" /> : null}
              Apply LoRAs
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={busy !== null || currentLoras.length === 0}>
                  <Trash2 />
                  Clear LoRAs
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all LoRAs?</AlertDialogTitle>
                  <AlertDialogDescription>This keeps the current model loaded but removes all applied LoRAs in the Python worker.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onClearLoras}>Clear</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {currentLoras.length > 0 ? (
            <div className="space-y-3">
              <Separator />
              <div className="space-y-1">
                <div className="text-sm font-medium">Trigger words</div>
                <p className="text-xs text-muted-foreground">Click a badge to copy it, then paste into your prompt.</p>
              </div>
              <div className="space-y-3">
                {currentLoras.map((l) => {
                  const name = basename(l.path);
                  const words = parseTriggerWords(l.triggerWords);
                  return (
                    <div key={l.path} className="space-y-2 rounded-lg border bg-muted/40 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" title={l.path}>
                          {name}
                        </Badge>
                        <Badge variant="outline">weight {l.weight}</Badge>
                      </div>
                      {words.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {words.map((w) => (
                            <Badge asChild key={w} variant="outline">
                              <button type="button" className="cursor-pointer" onClick={() => onCopyToClipboard(w)} title="Copy">
                                {w}
                              </button>
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">No trigger words (or failed to fetch).</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
