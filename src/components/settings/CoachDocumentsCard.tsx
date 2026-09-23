"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient, describeApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MAX_DOCUMENT_LENGTH, MAX_DOCUMENT_TITLE, MAX_DOCUMENTS } from "@/lib/coach-documents";

/**
 * Documents you have given FitBot, kept whole.
 *
 * The memory card above holds FACTS the coach plans around. This holds the
 * SOURCES those facts came from: an MRI report in the radiologist's own words,
 * a physio summary, a programme from a previous gym. They are kept verbatim
 * because nobody distils a report perfectly the first time, and because the
 * wording is what a clinician recognises.
 *
 * Same bargain as memory: FitBot may save one during a conversation without
 * asking, and this card is the other half - everything it is holding is listed
 * here, readable in full, and one tap from being deleted.
 */

const CARD = "card-elevated p-[18px]";
const EYEBROW = "font-mono text-[11px] uppercase tracking-[0.14em] text-tertiary-foreground";

type CoachDocument = {
  id: string;
  title: string;
  preview: string;
  characters: number;
  source: "fitbot" | "user";
  createdAt: string;
};

export function CoachDocumentsCard() {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: documents, isLoading } = useQuery<CoachDocument[]>({
    queryKey: ["/api/coach-documents"],
  });

  // Fetched only when one is opened: a library of reports is a large payload
  // and the listing deliberately carries previews instead.
  const { data: open } = useQuery<CoachDocument & { content: string }>({
    queryKey: [`/api/coach-documents/${openId}`],
    enabled: !!openId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/coach-documents"] });

  const add = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/coach-documents", {
        title: title.trim(),
        content: content.trim(),
      });
    },
    onSuccess: () => {
      setAdding(false);
      setTitle("");
      setContent("");
      void invalidate();
    },
    onError: (e) =>
      toast({ title: "Could not save that", description: describeApiError(e), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/coach-documents/${id}`);
    },
    onSuccess: (_d, id) => {
      if (openId === id) setOpenId(null);
      void invalidate();
    },
    onError: (e) =>
      toast({ title: "Could not delete that", description: describeApiError(e), variant: "destructive" }),
  });

  const list = documents ?? [];

  return (
    <div className={CARD} data-testid="card-coach-documents">
      <div className={`${EYEBROW} mb-1.5`}>Documents you have shared</div>
      <p className="mb-4 text-sm text-muted-foreground">
        Reports, scans and plans you have given FitBot, kept in full so it can read
        them again later. Paste one in and it will work your training around it.
      </p>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-documents-empty">
          Nothing yet. Paste an MRI report, a physio summary or an old programme.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((d) => (
            <li
              key={d.id}
              data-testid={`document-${d.id}`}
              className="rounded-[10px] border bg-white/[0.02] px-3 py-2"
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setOpenId(openId === d.id ? null : d.id)}
                  data-testid={`button-open-document-${d.id}`}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-tertiary-foreground" />
                    <span className="truncate">{d.title}</span>
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{d.preview}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-tertiary-foreground">
                    {d.createdAt.slice(0, 10)} · {d.characters.toLocaleString()} characters
                    {d.source === "fitbot" ? " · saved by FitBot" : ""}
                  </p>
                </button>
                <button
                  type="button"
                  aria-label={`Delete document: ${d.title}`}
                  data-testid={`button-delete-document-${d.id}`}
                  onClick={() => remove.mutate(d.id)}
                  className="mt-0.5 shrink-0 text-tertiary-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {openId === d.id && (
                <pre
                  data-testid={`document-body-${d.id}`}
                  className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap border-t pt-2 font-sans text-xs leading-relaxed text-muted-foreground"
                >
                  {open?.id === d.id ? open.content : "Loading..."}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="mt-4 space-y-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_DOCUMENT_TITLE}
            placeholder="Lumbar MRI, September 2026"
            data-testid="input-document-title"
          />
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={MAX_DOCUMENT_LENGTH}
            rows={8}
            placeholder="Paste the report here, exactly as you received it."
            data-testid="input-document-content"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!content.trim() || add.isPending}
              onClick={() => add.mutate()}
              data-testid="button-save-document"
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setTitle("");
                setContent("");
              }}
            >
              Cancel
            </Button>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.08em] text-tertiary-foreground">
              {content.length.toLocaleString()} / {MAX_DOCUMENT_LENGTH.toLocaleString()}
            </span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={list.length >= MAX_DOCUMENTS}
          data-testid="button-add-document"
          className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-primary disabled:text-tertiary-foreground"
        >
          <Plus className="h-4 w-4" />
          {list.length >= MAX_DOCUMENTS ? `Limit of ${MAX_DOCUMENTS} reached` : "Add a document"}
        </button>
      )}
    </div>
  );
}
