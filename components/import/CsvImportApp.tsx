"use client";

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import {
  Upload,
  FileSpreadsheet,
  Trash2,
  Send,
  CheckCircle,
  AlertTriangle,
  X,
  Edit3,
  Save,
  HardDrive,
  RefreshCw,
  FolderOpen,
  Filter,
  Merge,
  CheckSquare,
  Square,
  Copy,
  Check,
  Zap,
  Database,
  LayoutGrid,
  Rows3,
  Sparkles,
  Settings2,
  Users,
  MoreHorizontal,
  ChevronDown,
  Undo2,
  Palette,
  Link2,
  Search,
  Unlink,
  FileText,
  Layers3,
} from "lucide-react";
import {
  fetchLookupsAction,
  readLocalCsvAction,
  saveLocalCsvAction,
  getBatchProductsAction,
  saveBatchProductsAction,
  updateBatchProductAction,
  assignBatchVariantFamilyAction,
  detachBatchVariantProductAction,
  deleteBatchVariantFamilyAction,
  deleteBatchProductAction,
  getSupplierDataAction,
  runCustomSupplierScriptAction,
  type CsvProduct,
  type Lookups,
} from "@/actions/csv-import";
import { previewBatchPublishAction, pushBatchToCatalogAction, stopBatchPublishAction } from "@/actions/suppliers";
import type { BatchPublishProgress } from "@/lib/batch-publish-progress";
import {
  getBatchAiRunAction,
  getBatchAiRunLogsAction,
  getBatchAiSuggestionsAction,
  getBatchMediaSeoStatusAction,
  getLatestBatchAiRunAction,
  getBatchSnapshotsAction,
  rollbackBatchAction,
  rollbackBatchProductAiAction,
  startBatchAiAction,
  startBatchMediaSeoAction,
  stopBatchAiRunAction,
} from "@/actions/batch-ai";
import Image from "next/image";
import Link from "next/link";
import { imagePresets, resizeImageUrl } from "@/lib/image";
import { extractProductAttributes } from "@/lib/product-attributes";
import { validateProducts } from "@/lib/product-validation";
import AdminProductCard from "@/components/products/ProductCard";
import ProductPhotoGallery from "@/components/products/ProductPhotoGallery";
import BatchAiReviewDialog from "@/components/import/BatchAiReviewDialog";
import { MeasurementsField } from "@/components/catalog-attributes/CatalogAttributeFields";

const DEFAULT_PRODUCT_COLUMNS = [
  { name: "external_id", key: "external_id" },
  { name: "name", key: "name" },
  { name: "description", key: "description" },
  { name: "h1", key: "h1" },
  { name: "seo_title", key: "seo_title" },
  { name: "seo_description", key: "seo_description" },
  { name: "price", key: "price" },
  { name: "status", key: "status" },
  { name: "brand", key: "brand" },
  { name: "category", key: "category" },
  { name: "subcategory", key: "subcategory" },
  { name: "gender", key: "gender" },
  { name: "photos", key: "photos" },
  { name: "ai_processed", key: "ai_processed" },
  { name: "variant_group_key", key: "variant_group_key" },
];

const CSV_CORE_KEYS = new Set(DEFAULT_PRODUCT_COLUMNS.map((column) => column.key));

function attributeValuesForDisplay(value: unknown) {
  const values = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
  return values.map((item) => String(item).trim()).filter(Boolean);
}

function chromoffCategoryForDisplay(product: CsvProduct) {
  const attributes = product.attributes || {}
  const name = String(attributes.chromoff_category_name || '').trim()
  const status = String(attributes.chromoff_category_status || '').trim()
  if (!name && !status) return null
  return {
    name: name || 'Не определена',
    status,
    confidence: Number(attributes.chromoff_category_confidence || 0),
  }
}

function productVideoForDisplay(product: CsvProduct) {
  const attributes = product.attributes || {};
  const url = String(
    attributes.manual_video_url
      || attributes.hosted_video_url
      || attributes.szwego_video_url
      || (attributes as any).video_url
      || "",
  ).trim();
  const posterUrl = String(
    attributes.manual_video_poster_url
      || attributes.hosted_video_poster_url
      || attributes.szwego_video_poster_url
      || (attributes as any).video_poster_url
      || "",
  ).trim();
  return { url, posterUrl };
}

function approvedVariantGroupKey(product: CsvProduct) {
  const key = String(product.variant_group_key || "").trim();
  return /^[0-9a-f]{32}$/i.test(key) ? key : "";
}

function variantFamilyTitle(products: CsvProduct[]) {
  const first = products[0];
  if (!first) return "Семья без названия";
  const savedName = String(first.variant_group_name || "").trim();
  if (savedName) return savedName;
  const modelName = attributeValuesForDisplay(first.attributes?.model_name)[0];
  const modelCode = String(first.attributes?.model_code || "").trim();
  return modelName || modelCode || first.name || "Семья без названия";
}

function variantFamilyColors(products: CsvProduct[]) {
  return [...new Set(products.flatMap((product) => (
    attributeValuesForDisplay(product.attributes?.colors ?? product.attributes?.color)
  )))];
}

type VariantFamily = {
  key: string;
  products: CsvProduct[];
  title: string;
  colors: string[];
};

function AiQueuePhoto({ photo }: { photo: unknown }) {
  const source = typeof photo === "string" ? photo.trim() : "";
  const candidates = useMemo(() => {
    if (!/^https?:\/\//i.test(source)) return [];
    return [...new Set([
      source,
      resizeImageUrl(source, imagePresets.productTable),
    ].filter(Boolean))];
  }, [source]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const candidate = candidates[candidateIndex];

  if (!candidate) {
    return <Sparkles className="absolute inset-0 m-auto h-5 w-5 text-slate-600" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={candidate}
      alt=""
      loading="lazy"
      className="h-full w-full object-cover"
      onError={() => setCandidateIndex((index) => index + 1)}
    />
  );
}

// ─── CSV Parsing ───────────────────────────────────────────────────────

function parseCsv(text: string): {
  products: CsvProduct[];
  columns: { name: string; key: string }[];
  delimiter: string;
} {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  const normalizedText = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const firstLine = normalizedText.split("\n")[0] || "";
  const delimiter = detectDelimiter(firstLine);

  for (let i = 0; i < normalizedText.length; i++) {
    const char = normalizedText[i];
    const nextChar = normalizedText[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped "" -> "
          currentField += '"';
          i++;
        } else {
          // Closing quote
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"' && currentField.trim().length === 0) {
        inQuotes = true;
        currentField = ""; // reset to ignore leading spaces
      } else if (char === delimiter) {
        currentRow.push(currentField.trim());
        currentField = "";
      } else if (char === "\n") {
        currentRow.push(currentField.trim());
        if (currentRow.some((v) => v.trim() !== "")) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = "";
      } else {
        currentField += char;
      }
    }
  }

  if (currentField !== "" || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((v) => v.trim() !== "")) {
      rows.push(currentRow);
    }
  }

  if (rows.length < 1) return { products: [], columns: [], delimiter: "," };

  const headerRow = rows[0];
  const columns = headerRow.map((h) => {
    const lower = h.toLowerCase().trim();
    let key = lower;
    if (["productid", "product_id", "id", "артикул", "идентификатор", "external_id"].includes(lower)) key = "external_id";
    else if (["name", "title", "имя", "название", "товар"].includes(lower)) key = "name";
    else if (["description", "desc", "описание"].includes(lower)) key = "description";
    else if (["price", "цена", "стоимость"].includes(lower)) key = "price";
    else if (["status", "статус"].includes(lower)) key = "status";
    else if (["brand", "бренд", "марка"].includes(lower)) key = "brand";
    else if (["category", "категория"].includes(lower)) key = "category";
    else if (["subcategory", "подкатегория"].includes(lower)) key = "subcategory";
    else if (["photos", "images", "image_urls", "фото", "картинки", "изображения", "ссылки"].includes(lower)) key = "photos";
    else if (["gender", "пол"].includes(lower)) key = "gender";
    return { name: h, key };
  });

  const products = rows
    .slice(1)
    .map((values) => {
      // --- Row Healer Logic ---
      // Если у нас слишком мало колонок (например, 3 вместо 10) и одна из них подозрительно длинная и содержит разделитель,
      // значит парсер "проглотил" несколько колонок в одну из-за кривых кавычек.
      if (
        values.length < columns.length / 2 &&
        values.some((v) => v.includes(delimiter))
      ) {
        const healedValues: string[] = [];
        for (const val of values) {
          // Не "лечим" если это похоже на JSON массив (начинается на [)
          if (val.includes(delimiter) && val.length > 50 && !val.trim().startsWith('[')) {
            // Рекурсивно пробуем распарсить это поле как мини-строку CSV без учета внешних кавычек
            const subParts = val.split(delimiter);
            healedValues.push(...subParts);
          } else {
            healedValues.push(val);
          }
        }
        if (healedValues.length > values.length) {
          values = healedValues;
        }
      }

      if (values.length === 0 || values.every((v) => !v.trim())) return null;

      const product: any = {};
      const rawAttributes: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        let val = (values[i] || "").trim();

        // ФИКС: В файле пользователя есть лишняя запятая перед фото (,,), 
        // из-за чего данные смещены на 1 колонку вправо.
        if (col.key === "photos" && !val && values.length > columns.length) {
          // Ищем в оставшейся части ряда что-то похожее на JSON-массив или URL
          for (let j = i + 1; j < values.length; j++) {
            const suspect = (values[j] || "").trim();
            if (suspect.startsWith('[') || suspect.startsWith('http')) {
              val = suspect;
              break;
            }
          }
        }

        if (col.key === "photos") {
          let photos: string[] = [];
          if (val) {
            // Очистка от кавычек, если они пролезли (например, ""url"")
            let cleanVal = val.trim();
            if (cleanVal.startsWith('"') && cleanVal.endsWith('"')) {
              cleanVal = cleanVal.slice(1, -1).trim();
            }
            // Стандартное unescape для CSV: "" -> "
            cleanVal = cleanVal.replace(/""/g, '"');

            if (cleanVal.startsWith("[") && cleanVal.endsWith("]")) {
              try {
                const parsed = JSON.parse(cleanVal);
                photos = Array.isArray(parsed) ? parsed : [parsed];
              } catch {
                // Если не JSON, но в скобках []
                photos = cleanVal
                  .slice(1, -1)
                  .split(/[|,;]/)
                  .map((s) => s.trim().replace(/^["']|["']$/g, ""))
                  .filter(Boolean);
              }
            } else {
              // Просто список ссылок через разделители
              photos = cleanVal
                .split(/[|,;]/)
                .map((s) => s.trim().replace(/^["']|["']$/g, ""))
                .filter(Boolean);
            }
          }
          product[col.key] = photos;
        } else if (col.key === "price") {
          const numeric = val.replace(/[^\d.,]/g, "").replace(",", ".");
          product[col.key] = parseFloat(numeric) || 0;
        } else if (col.key === "status") {
          const low = val.toLowerCase();
          product[col.key] =
            low === "inactive" || low === "0" ? "inactive" : "active";
        } else {
          // Убираем двойные кавычки, если они пролезли в обычные поля
          product[col.key] = val.replace(/""/g, '"');
          if (!CSV_CORE_KEYS.has(col.key)) rawAttributes[col.key] = product[col.key];
        }
      });

      product.attributes = extractProductAttributes({
        ...rawAttributes,
        attributes: product.attributes,
      });

      // Ensure baseline fields are never undefined to prevent corruption on save
      product.external_id = product.external_id || "";
      product.name = product.name || "";
      product.price = product.price || 0;
      product.status = product.status || "active";
      product.photos = product.photos || [];

      // Final sanity check
      if (!product.external_id && !product.name) return null;

      return product as CsvProduct;
    })
    .filter((p): p is CsvProduct => p !== null);

  return { products, columns, delimiter };
}

function detectDelimiter(headerLine: string): string {
  let semis = 0,
    commas = 0,
    inQuotes = false;
  for (const char of headerLine) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (char === ";") semis++;
      if (char === ",") commas++;
    }
  }
  return semis > commas ? ";" : ",";
}

function resolveName(
  id: string,
  items: { id: string; name: string }[],
): string {
  if (!id) return "";
  const found = items.find((i) => i.id === id);
  return found ? found.name : id;
}

function SearchableLookupSelect({
  value,
  items,
  onChange,
  placeholder,
  disabled = false,
}: {
  value: string;
  items: { id: string; name: string }[];
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const selectedLabel = resolveName(value, items);
  const [query, setQuery] = useState(selectedLabel);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setQuery(selectedLabel);
  }, [selectedLabel]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const knownItems = items.filter((item) => {
      if (!normalized) return true;
      return `${item.name} ${item.id}`.toLowerCase().includes(normalized);
    });

    if (value && !items.some((item) => item.id === value)) {
      return [{ id: value, name: value }, ...knownItems].slice(0, 80);
    }

    return knownItems.slice(0, 80);
  }, [items, query, value]);

  const selectItem = (item: { id: string; name: string }) => {
    onChange(item.id);
    setQuery(item.name);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <input
        type="search"
        value={query}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 120)}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 pr-9 text-slate-300 text-sm outline-none focus:border-indigo-500 disabled:opacity-60"
      />
      {value && !disabled && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange("");
            setQuery("");
            setIsOpen(false);
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-white rounded"
          title="Очистить"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {isOpen && !disabled && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          {filteredItems.length > 0 ? (
            filteredItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectItem(item);
                }}
                className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-slate-800 ${
                  item.id === value ? "text-indigo-300" : "text-slate-300"
                }`}
              >
                <span className="block truncate">{item.name}</span>
                <span className="block truncate text-[10px] text-slate-500">
                  {item.id}
                </span>
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-slate-500">
              Ничего не найдено
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────

export default function CsvImportApp({
  initialLocalPath = "",
  initialSupplierId = null,
  initialBatchId = null,
  initialSnapshotId = null,
  initialSupplierName = null,
  initialSupplierAvatar = null,
  initialSourceLabel = null,
  backHref = null,
  onClose,
}: {
  initialLocalPath?: string;
  initialRawPath?: string;
  initialAiPath?: string;
  initialSupplierId?: number | null;
  initialBatchId?: string | null;
  initialSnapshotId?: string | null;
  initialSupplierName?: string | null;
  initialSupplierAvatar?: string | null;
  initialSourceLabel?: string | null;
  backHref?: string | null;
  onClose?: () => void;
}) {
  const [products, setProducts] = useState<CsvProduct[]>([]);
  const [columns, setColumns] = useState<{ name: string; key: string }[]>([]);
  const [delimiter, setDelimiter] = useState(",");
  const [fileName, setFileName] = useState("");
  const [sourceLabel, setSourceLabel] = useState<string | null>(initialSourceLabel);
  const [batchStage, setBatchStage] = useState("SCRAPED");
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [showPublishMenu, setShowPublishMenu] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [publishProgress, setPublishProgress] = useState<{
    phase: "lookup" | "media" | "publish";
    current: number;
    total: number;
  } | null>(null);
  const [publishOperation, setPublishOperation] = useState<BatchPublishProgress | null>(null);
  const [isStoppingPublish, setIsStoppingPublish] = useState(false);
  const [result, setResult] = useState<{
    success: number;
    updated: number;
    skipped: number;
    failed: number;
    errors: string[];
  } | null>(null);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [selectedForMerge, setSelectedForMerge] = useState<number[]>([]); // Список индексов в порядке выбора
  const selectionAnchorRef = useRef<number | null>(null);
  const [previousProducts, setPreviousProducts] = useState<CsvProduct[] | null>(
    null,
  ); // Для отмены объединения

  // Local file mode
  const [importMode, setImportMode] = useState<"upload" | "local">("upload");
  const [localPath, setLocalPath] = useState("");
  const [isLoadingPath, setIsLoadingPath] = useState(false);
  
  const [pathError, setPathError] = useState("");

  // Dirty flag — были ли изменения с момента последнего сохранения
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [filterBrand, setFilterBrand] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSubcategory, setFilterSubcategory] = useState("");
  const [filterGender, setFilterGender] = useState("");
  const [filterPrice, setFilterPrice] = useState("");
  const [filterModel, setFilterModel] = useState("");
  const [filterColor, setFilterColor] = useState("");
  const [filterVariants, setFilterVariants] = useState<"" | "with" | "without">("");
  const [filterVideo, setFilterVideo] = useState<"" | "with" | "without">("");
  const [filterAiStatus, setFilterAiStatus] = useState<"" | "raw" | "ready" | "error">("");
  const [viewMode, setViewMode] = useState<"cards" | "rows">("cards");
  const [cardColumns, setCardColumns] = useState(4);
  const [showVariantFamilies, setShowVariantFamilies] = useState(false);
  const [showBulkVariantFamily, setShowBulkVariantFamily] = useState(false);
  const [bulkBrand, setBulkBrand] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkSubcategory, setBulkSubcategory] = useState("");
  const [bulkPrice, setBulkPrice] = useState("");
  const [supplierId, setSupplierId] = useState<number | null>(initialSupplierId);
  const [batchId, setBatchId] = useState<string | null>(initialSnapshotId ? null : initialBatchId);
  const actionBarRef = useRef<HTMLDivElement | null>(null);
  const [actionBarHeight, setActionBarHeight] = useState(72);
  const [activeSnapshotId, setActiveSnapshotId] = useState<string | null>(initialSnapshotId);
  const isBatchSource = Boolean(batchId);
  const isSnapshotSource = Boolean(activeSnapshotId);
  const scriptBatchId = batchId || (batchStage === "SCRAPED" ? initialBatchId : null);

  const [isProcessing, setIsProcessing] = useState(false)
  const [isRollingBackAiSample, setIsRollingBackAiSample] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<any[]>([])
  const [showAiSuggestions, setShowAiSuggestions] = useState(false)
  const [aiProgress, setAiProgress] = useState<{current: number, total: number, failed: number} | null>(null);
  const [activeAiRunId, setActiveAiRunId] = useState<string | null>(null);
  const [aiQueue, setAiQueue] = useState<any[]>([]);
  const [latestAiRun, setLatestAiRun] = useState<any | null>(null);
  const [activeAiRunMode, setActiveAiRunMode] = useState<string | null>(null);
  const [aiLogs, setAiLogs] = useState<any[]>([]);
  const [showAiLogs, setShowAiLogs] = useState(false);
  const [showAiErrors, setShowAiErrors] = useState(false);
  const [isLoadingAiLogs, setIsLoadingAiLogs] = useState(false);
  const [canGenerateMediaSeo, setCanGenerateMediaSeo] = useState(false);
  const [supplierData, setSupplierData] = useState<{album_id: string, post_process_script: string | null, post_process_enabled?: boolean, ai_parallel_enabled?: boolean, ai_parallel_count?: number} | null>(null);
  const [isRunningCustomScript, setIsRunningCustomScript] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchUpdateTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const catalogReferenceSignature = useMemo(() => JSON.stringify({
    brands: [...new Set(products.map((product) => String(product.brand || "")).filter(Boolean))].sort(),
    categories: [...new Set(products.map((product) => String(product.category || "")).filter(Boolean))].sort(),
    subcategories: [...new Set(products.map((product) => String(product.subcategory || "")).filter(Boolean))].sort(),
  }), [products]);

  useEffect(() => {
    fetchLookupsAction().then(setLookups).catch(console.error);

    if (initialSupplierId) {
      setSupplierId(initialSupplierId);
      getSupplierDataAction(initialSupplierId).then(setSupplierData).catch(console.error);
    }
    if (initialBatchId) {
      setActiveSnapshotId(initialSnapshotId);
      setBatchId(initialSnapshotId ? null : initialBatchId);
      handleLoadBatch(initialBatchId, initialSnapshotId);
    } else if (initialLocalPath) {
      setLocalPath(initialLocalPath);
      setImportMode("local");
      handleLoadPath(initialLocalPath); // ЗАГРУЖАЕМ НАПРЯМУЮ
    } else {
      const savedPath = localStorage.getItem("csv_local_path");
      if (savedPath) setLocalPath(savedPath);
      const savedMode = localStorage.getItem("csv_import_mode");
      if (savedMode === "local") setImportMode("local");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLocalPath, initialSupplierId, initialBatchId, initialSnapshotId]);

  useEffect(() => {
    if (!products.length) return;
    fetchLookupsAction(JSON.parse(catalogReferenceSignature)).then(setLookups).catch(console.error);
  }, [catalogReferenceSignature, products.length]);

  useEffect(() => {
    const timers = batchUpdateTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    const element = actionBarRef.current;
    if (!element) return;
    const updateHeight = () => setActionBarHeight(element.getBoundingClientRect().height);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [products.length]);

  useEffect(() => {
    const progressBatchId = batchId || initialBatchId;
    if (!progressBatchId) return;
    let cancelled = false;
    const poll = async () => {
      const response = await fetch(`/api/batches/publish-progress?batchId=${encodeURIComponent(progressBatchId)}`, {
        cache: "no-store",
      }).then((result) => result.ok ? result.json() : null).catch(() => null);
      if (cancelled || !response?.success) return;
      const operation = response.data as BatchPublishProgress;
      setPublishOperation(operation);
      if (operation.running || operation.stale) {
        setPublishProgress({
          phase: operation.phase || "publish",
          current: Number(operation.current || 0),
          total: Number(operation.total || products.length),
        });
      } else if (!isPushing) {
        setPublishProgress(null);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isPushing, batchId, initialBatchId, products.length]);

  useEffect(() => {
    if (!batchId || isSnapshotSource) {
      setCanGenerateMediaSeo(false);
      return;
    }
    let cancelled = false;
    getBatchMediaSeoStatusAction(batchId).then((result) => {
      if (!cancelled) setCanGenerateMediaSeo(Boolean(result.success && result.data?.allowed));
    }).catch(() => {
      if (!cancelled) setCanGenerateMediaSeo(false);
    });
    return () => { cancelled = true; };
  }, [batchId, isSnapshotSource]);


  // Unique values for filters (derived from all products)
  const uniqueBrands = useMemo(() => {
    const brands = [...new Set(products.map((p) => p.brand).filter(Boolean))];
    if (products.some((p) => !p.brand)) brands.push("__EMPTY__");
    return brands;
  }, [products]);

  const uniqueCategories = useMemo(() => {
    const cats = [...new Set(products.map((p) => p.category).filter(Boolean))];
    if (products.some((p) => !p.category)) cats.push("__EMPTY__");
    return cats;
  }, [products]);

  const uniqueSubcategories = useMemo(() => {
    const subcats = [
      ...new Set(products.map((p) => p.subcategory).filter(Boolean)),
    ];
    if (products.some((p) => !p.subcategory)) subcats.push("__EMPTY__");
    return subcats;
  }, [products]);

  const uniqueGenders = useMemo(() => {
    const genders = [...new Set(products.map((p) => p.gender).filter(Boolean))];
    if (products.some((p) => !p.gender)) genders.push("__EMPTY__");
    return genders;
  }, [products]);

  const uniquePrices = useMemo(
    () => [...new Set([0, ...products.map((product) => Number(product.price) || 0)])].sort((a, b) => a - b),
    [products],
  );
  const countBy = useCallback((values: string[]) => {
    const counts = new Map<string, number>();
    values.forEach((value) => counts.set(value || "__EMPTY__", (counts.get(value || "__EMPTY__") || 0) + 1));
    return counts;
  }, []);
  const brandCounts = useMemo(() => countBy(products.map((product) => String(product.brand || ""))), [products, countBy]);
  const categoryCounts = useMemo(() => countBy(products.map((product) => String(product.category || ""))), [products, countBy]);
  const subcategoryCounts = useMemo(() => countBy(products.map((product) => String(product.subcategory || ""))), [products, countBy]);
  const genderCounts = useMemo(() => countBy(products.map((product) => String(product.gender || ""))), [products, countBy]);
  const attributeValues = useCallback((value: unknown) => {
    const values = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
    return values.map((item) => String(item).trim()).filter(Boolean);
  }, []);
  const uniqueModels = useMemo(() => {
    const values = [...new Set(products.flatMap((product) => attributeValues(product.attributes?.model_name)))].sort();
    if (products.some((product) => attributeValues(product.attributes?.model_name).length === 0)) values.unshift("__EMPTY__");
    return values;
  }, [products, attributeValues]);
  const uniqueColors = useMemo(() => {
    const values = [...new Set(products.flatMap((product) => attributeValues(product.attributes?.colors ?? product.attributes?.color)))].sort();
    if (products.some((product) => attributeValues(product.attributes?.colors ?? product.attributes?.color).length === 0)) values.unshift("__EMPTY__");
    return values;
  }, [products, attributeValues]);
  const modelCounts = useMemo(() => countBy(products.flatMap((product) => {
    const values = attributeValues(product.attributes?.model_name);
    return values.length ? values : [""];
  })), [products, attributeValues, countBy]);
  const colorCounts = useMemo(() => countBy(products.flatMap((product) => {
    const values = attributeValues(product.attributes?.colors ?? product.attributes?.color);
    return values.length ? values : [""];
  })), [products, attributeValues, countBy]);
  const productsWithVideoCount = useMemo(
    () => products.filter((product) => Boolean(productVideoForDisplay(product).url)).length,
    [products],
  );
  const variantGroups = useMemo(() => {
    const groups = new Map<string, CsvProduct[]>();
    for (const product of products) {
      const key = approvedVariantGroupKey(product);
      if (!key) continue;
      groups.set(key, [...(groups.get(key) || []), product]);
    }
    for (const [key, group] of groups) {
      if (group.length < 2) groups.delete(key);
    }
    return groups;
  }, [products]);
  const productsWithVariantsCount = useMemo(
    () => products.filter((product) => variantGroups.has(approvedVariantGroupKey(product))).length,
    [products, variantGroups],
  );
  const variantFamilyList = useMemo(() => (
    [...variantGroups.entries()]
      .map(([key, familyProducts]) => ({
        key,
        products: familyProducts,
        title: variantFamilyTitle(familyProducts),
        colors: variantFamilyColors(familyProducts),
      }))
      .sort((left, right) => left.title.localeCompare(right.title, "ru"))
  ), [variantGroups]);
  const priceCounts = useMemo(() => countBy(products.map((product) => String(Number(product.price) || 0))), [products, countBy]);

  const aiReadyCount = useMemo(
    () => products.filter((product) => product.ai_processed === true || product.ai_processed === "true").length,
    [products],
  );
  const aiRemainingCount = products.length - aiReadyCount;
  const aiSampleCount = useMemo(
    () => products.filter((product) => product.ai_sampled === true).length,
    [products],
  );
  const aiErrorProducts = useMemo(
    () => products.filter((product) => !(product.ai_processed === true || product.ai_processed === "true") && Boolean(product.ai_error)),
    [products],
  );
  const aiErrorGroups = useMemo(() => {
    const groups = new Map<string, number>();
    for (const product of aiErrorProducts) {
      const message = String(product.ai_error || "Неизвестная ошибка");
      groups.set(message, (groups.get(message) || 0) + 1);
    }
    return [...groups.entries()].sort((left, right) => right[1] - left[1]);
  }, [aiErrorProducts]);
  const mediaSeoProducts = useMemo(
    () => products.filter((product) => Boolean(product.slug)
      && Array.isArray(product.photo_alts) && product.photo_alts.length === product.photos.length
      && Array.isArray(product.photo_slugs) && product.photo_slugs.length === product.photos.length),
    [products],
  );
  const canPublish = isBatchSource && ["SCRIPT_PROCESSED", "AI_PROCESSED"].includes(batchStage) && products.length > 0 && aiRemainingCount === 0;
  const pendingAiSuggestions = useMemo(
    () => aiSuggestions.filter((item) => item.status === "pending"),
    [aiSuggestions],
  );

  const loadAiSuggestions = useCallback(async (nextBatchId: string) => {
    const result = await getBatchAiSuggestionsAction(nextBatchId);
    setAiSuggestions(result.success ? result.data || [] : []);
  }, []);

  const toggleAiLogs = useCallback(async () => {
    if (showAiLogs) {
      setShowAiLogs(false);
      return;
    }
    const runId = activeAiRunId || latestAiRun?.id;
    if (!runId) return;
    setShowAiLogs(true);
    setIsLoadingAiLogs(true);
    try {
      const result = await getBatchAiRunLogsAction(String(runId));
      setAiLogs(result.success ? result.data || [] : []);
    } finally {
      setIsLoadingAiLogs(false);
    }
  }, [activeAiRunId, latestAiRun?.id, showAiLogs]);

  const isMediaSeoRun = activeAiRunMode
    ? activeAiRunMode === "media_seo"
    : latestAiRun?.mode === "media_seo";
  const mediaSeoRunFinished = isMediaSeoRun && ["completed", "failed", "cancelled"].includes(String(latestAiRun?.status || ""));

  // Filtered products for display
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (filterBrand) {
        if (filterBrand === "__EMPTY__") {
          if (p.brand) return false;
        } else if (p.brand !== filterBrand) {
          return false;
        }
      }
      if (filterCategory) {
        if (filterCategory === "__EMPTY__") {
          if (p.category) return false;
        } else if (p.category !== filterCategory) {
          return false;
        }
      }
      if (filterSubcategory) {
        if (filterSubcategory === "__EMPTY__") {
          if (p.subcategory) return false;
        } else if (p.subcategory !== filterSubcategory) {
          return false;
        }
      }
      if (filterGender) {
        if (filterGender === "__EMPTY__") {
          if (p.gender) return false;
        } else if (p.gender !== filterGender) {
          return false;
        }
      }
      if (filterPrice !== "" && (Number(p.price) || 0) !== Number(filterPrice)) {
        return false;
      }
      const models = attributeValues(p.attributes?.model_name);
      if (filterModel === "__EMPTY__" ? models.length > 0 : filterModel && !models.includes(filterModel)) return false;
      const colors = attributeValues(p.attributes?.colors ?? p.attributes?.color);
      if (filterColor === "__EMPTY__" ? colors.length > 0 : filterColor && !colors.includes(filterColor)) return false;
      const hasVariants = variantGroups.has(approvedVariantGroupKey(p));
      if (filterVariants === "with" && !hasVariants) return false;
      if (filterVariants === "without" && hasVariants) return false;
      const hasVideo = Boolean(productVideoForDisplay(p).url);
      if (filterVideo === "with" && !hasVideo) return false;
      if (filterVideo === "without" && hasVideo) return false;
      const aiReady = p.ai_processed === true || p.ai_processed === "true";
      if (filterAiStatus === "raw" && aiReady) return false;
      if (filterAiStatus === "ready" && !aiReady) return false;
      if (filterAiStatus === "error" && (aiReady || !p.ai_error)) return false;
      return true;
    });
  }, [products, filterBrand, filterCategory, filterSubcategory, filterGender, filterPrice, filterModel, filterColor, filterVariants, filterVideo, filterAiStatus, attributeValues, variantGroups]);

  const sampleProducts = useMemo(
    () => filteredProducts.filter((product) => product.ai_sampled === true),
    [filteredProducts],
  );
  const displayedProducts = useMemo(
    () => sampleProducts.length > 0
      ? [...sampleProducts, ...filteredProducts.filter((product) => product.ai_sampled !== true)]
      : filteredProducts,
    [filteredProducts, sampleProducts],
  );

  // ─── Upload Mode ──────────────────────────────────────────────────
  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv")) {
      alert("Пожалуйста, загрузите файл CSV");
      return;
    }
    setFileName(file.name);
    setResult(null);
    setIsDirty(false);
    setSaveMsg(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const { products, columns, delimiter } = parseCsv(e.target?.result as string);
      setProducts(products);
      setColumns(columns);
      setDelimiter(delimiter);
    };
    reader.readAsText(file, "utf-8");
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (importMode !== "upload") return;
      if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
    },
    [handleFile, importMode],
  );

  // ─── Local File Mode ──────────────────────────────────────────────
  const handleLoadPath = async (path: string) => {
    if (!path.trim()) return;
    setIsLoadingPath(true);
    setPathError("");
    setResult(null);
    setSaveMsg(null);
    setIsDirty(false);
    const res = await readLocalCsvAction(path);
    if (res.success && res.content) {
      const { products, columns, delimiter } = parseCsv(res.content);
      setProducts(products);
      setColumns(columns);
      setDelimiter(delimiter);
      setFileName(path.split(/[/\\]/).pop() || "local.csv");
      setSourceLabel(res.source === 'db' ? 'Снимок CSV из истории' : 'Локальный CSV-файл');
      localStorage.setItem("csv_local_path", path);

    } else {
      setPathError(res.error || "Не удалось прочитать файл");
    }
    setIsLoadingPath(false);
  };

  const handleLoadBatch = async (nextBatchId: string, snapshotId?: string | null) => {
    setIsLoadingPath(true);
    setPathError("");
    setResult(null);
    setSaveMsg(null);
    setIsDirty(false);
    const res = await getBatchProductsAction(nextBatchId, snapshotId);
    if (!snapshotId) await loadAiSuggestions(nextBatchId);
    if (res.success && res.data) {
      setActiveSnapshotId(snapshotId || null);
      setProducts(res.data.products);
      setColumns(res.data.columns?.length ? res.data.columns : DEFAULT_PRODUCT_COLUMNS);
      setDelimiter(res.data.delimiter || ";");
      setBatchStage(res.data.stage || "SCRAPED");
      setFileName(`Партия ${nextBatchId.slice(0, 8)}`);
      setSourceLabel(res.data.snapshot ? `${res.data.label} · только просмотр` : 'Текущая БД-версия партии');
      setImportMode("local");
    } else {
      setPathError(res.error || "Не удалось загрузить товары партии");
    }
    setIsLoadingPath(false);
  };

  const handleOpenCurrentBatch = async () => {
    if (!initialBatchId || !isSnapshotSource) return;
    window.history.replaceState(window.history.state, "", `/admin/batches/${encodeURIComponent(initialBatchId)}`);
    setBatchId(initialBatchId);
    setActiveSnapshotId(null);
    await handleLoadBatch(initialBatchId);
  };

  useEffect(() => {
    if (!batchId || isSnapshotSource) return;
    let requestInFlight = false;
    const refreshDynamicState = async () => {
      if (requestInFlight || document.hidden) return;
      requestInFlight = true;
      try {
        const [productsResult, suggestionsResult, runResult] = await Promise.all([
          getBatchProductsAction(batchId),
          getBatchAiSuggestionsAction(batchId, false),
          getLatestBatchAiRunAction(batchId),
        ]);
        if (!isDirty && selectedIdx === null && productsResult.success && productsResult.data) {
          const nextProducts = productsResult.data.products;
          setProducts(nextProducts);
          setColumns(productsResult.data.columns?.length ? productsResult.data.columns : DEFAULT_PRODUCT_COLUMNS);
          setBatchStage(productsResult.data.stage || "SCRAPED");
        }
        setAiSuggestions(suggestionsResult.success ? suggestionsResult.data || [] : []);
        const run: any = runResult.success ? runResult.data : null;
        setLatestAiRun(run);
        setActiveAiRunMode(run?.mode || null);
        const running = Boolean(run && ["preparing", "queued", "running"].includes(run.status));
        setActiveAiRunId(running ? String(run.id) : null);
        setIsProcessing(running);
        setAiProgress(running ? {
          current: Number(run.completed_count || 0) + Number(run.failed_count || 0),
          total: Number(run.total_count || products.length),
          failed: Number(run.failed_count || 0),
        } : null);
        setAiQueue(running ? run.queue_items || [] : []);
      } finally {
        requestInFlight = false;
      }
    };
    refreshDynamicState();
    const interval = window.setInterval(refreshDynamicState, 3000);
    return () => window.clearInterval(interval);
  }, [batchId, isDirty, selectedIdx, products.length, isSnapshotSource]);

  const persistBatchProducts = async (nextProducts: CsvProduct[]) => {
    if (isSnapshotSource) {
      setSaveMsg('Снимок этапа доступен только для просмотра');
      return false;
    }
    if (!batchId) return true;
    const res = await saveBatchProductsAction(batchId, nextProducts);
    if (res.success) {
      setIsDirty(false);
      setSaveMsg("✓ Сохранено в БД");
      setTimeout(() => setSaveMsg(null), 3000);
      return true;
    }
    setSaveMsg("✗ Ошибка БД: " + (res.error || "unknown"));
    return false;
  };

  const loadFromPath = async () => {
    await handleLoadPath(localPath);
  };

  // ─── Кнопка «Сохранить в файл» ───────────────────────────────────
  const handleSaveToFile = async () => {
    if (products.length === 0) return;
    setIsSaving(true);
    setSaveMsg(null);
    try {
      if (batchId) {
        await persistBatchProducts(products);
        setIsSaving(false);
        return;
      }
      if (!localPath) {
        setIsSaving(false);
        return;
      }
      const res = await saveLocalCsvAction(
        localPath,
        products,
        columns,
        delimiter
      );
      if (res.success) {
        setIsDirty(false);
        setSaveMsg("✓ Файл сохранён");
        setTimeout(() => setSaveMsg(null), 3000);
      } else {
        setSaveMsg("✗ Ошибка: " + (res.error || "unknown"));
      }
    } catch (e: any) {
      setSaveMsg("✗ " + e.message);
    }
    setIsSaving(false);
  };

  // ─── Data Handlers ────────────────────────────────────────────────
  const handlePush = async (mode: "add" | "upsert" = "add", replaceMissing = false) => {
    if (products.length === 0) return;
    const targetBatchId = batchId || initialBatchId;
    if (!targetBatchId) {
      setSaveMsg("Публикация доступна только из JSONB-партии. Откройте текущую выгрузку, а не старый CSV-артефакт.");
      return;
    }
    const validationIssues = validateProducts(products);
    const validationErrors = validationIssues.filter((issue) => issue.severity === "error");
    if (validationErrors.length > 0) {
      alert(`Публикация остановлена. Исправьте ошибки:\n${validationErrors.slice(0, 10).map((issue) => `Строка ${issue.row}: ${issue.message}`).join("\n")}`);
      return;
    }
    const validationWarnings = validationIssues.filter((issue) => issue.severity === "warning");
    if (validationWarnings.length > 0) {
      setSaveMsg(`⚠ Предупреждений: ${validationWarnings.length}`);
    }

    if (targetBatchId) {
      if (!isSnapshotSource) {
        const preview = await previewBatchPublishAction(targetBatchId, mode, replaceMissing);
        if (!preview.success) {
          setSaveMsg(`✗ Не удалось подготовить предпросмотр: ${preview.error || "unknown"}`);
          return;
        }
        const data = preview.data as any;
        const shouldContinue = window.confirm(
          `Предпросмотр публикации\n\n` +
          `Всего в партии: ${data.total}\n` +
          `Новых: ${data.newCount}\n` +
          `Будет обновлено: ${data.updateCount}\n` +
          `Будет пропущено: ${data.skippedCount}\n` +
          `Будет удалено из каталога: ${data.deleteCount}\n` +
          `Видео к переносу в S3: ${data.videoCount}\n\n` +
          `Продолжить публикацию?`,
        );
        if (!shouldContinue) return;
      }
      setIsPushing(true);
      setPublishProgress({ phase: "lookup", current: 0, total: products.length });
      try {
        const saved = isSnapshotSource ? true : await persistBatchProducts(products);
        if (!saved) return;
        const pushResult = await pushBatchToCatalogAction(targetBatchId, isSnapshotSource ? "upsert" : mode, activeSnapshotId, replaceMissing);
        if (pushResult.success) {
          setResult({
            success: Number(pushResult.data?.success || 0),
            updated: Number(pushResult.data?.updated || 0),
            skipped: Number(pushResult.data?.skippedExisting || 0) + Number(pushResult.data?.skippedUnchanged || 0),
            failed: Number(pushResult.data?.failed || 0),
            errors: pushResult.data?.errors || [],
          });
          const videoWarnings = Array.isArray(pushResult.data?.videoWarnings) ? pushResult.data.videoWarnings : [];
          setSaveMsg(`✓ Новых: ${Number(pushResult.data?.success || 0)}, обновлено: ${Number(pushResult.data?.updated || 0)}, удалено из каталога: ${Number(pushResult.data?.deleted || 0)}, без изменений: ${Number(pushResult.data?.skippedUnchanged || 0)}, уже существовало: ${Number(pushResult.data?.skippedExisting || 0)}${videoWarnings.length ? ` · видео с ошибками: ${videoWarnings.length}` : ""}`);
          setBatchStage("PUSHED");
        } else {
          setSaveMsg(`✗ Ошибка публикации: ${pushResult.error || "unknown"}`);
        }
      } catch (error: any) {
        setSaveMsg(`✗ Ошибка публикации: ${error.message || "unknown"}`);
      } finally {
        setIsPushing(false);
        setPublishProgress(null);
      }
      return;
    }

  };

  const handleStopPublish = async () => {
    const targetBatchId = batchId || initialBatchId;
    if (!targetBatchId || isStoppingPublish) return;
    setIsStoppingPublish(true);
    try {
      const response = await stopBatchPublishAction(targetBatchId);
      setSaveMsg(response.success
        ? `✓ ${response.data?.message || "Операция остановлена"}`
        : `✗ ${response.error || "Не удалось остановить публикацию"}`);
      if (response.success && response.data?.released) {
        setPublishOperation(null);
        setPublishProgress(null);
      }
    } finally {
      setIsStoppingPublish(false);
    }
  };

  const handleAiProcess = async (requestedMode?: "sample" | "full" | "variants" | "selection" | "reprocess" | "recover_measurements" | "media_seo" | "split_colors", selectedProductIds?: number[]) => {
    const targetBatchId = batchId || initialBatchId;
    if (!targetBatchId) {
      setSaveMsg("AI-обработка доступна только для JSONB-партии из истории выгрузок.");
      return;
    }
    if (!supplierId && products.length > 0) {
        alert("ID поставщика не найден. Пожалуйста, запустите обработку из истории выгрузок.");
        return;
    }

    if (targetBatchId) {
      setIsProcessing(true);
      try {
        setShowAiLogs(false);
        setShowAiErrors(false);
        setAiLogs([]);
        if (isSnapshotSource) {
          setBatchId(targetBatchId);
          setActiveSnapshotId(null);
          await handleLoadBatch(targetBatchId);
        }
        const alreadyProcessed = products.some((product) => product.ai_processed === true || product.ai_processed === "true");
        const mode = requestedMode || (alreadyProcessed ? "full" : "sample");
        setActiveAiRunMode(mode);
        const result = mode === "media_seo"
          ? await startBatchMediaSeoAction(targetBatchId, selectedProductIds)
          : await startBatchAiAction(targetBatchId, mode, selectedProductIds);
        if (result.success) {
          const data: any = "data" in result ? result.data : null;
          if (data?.runId) {
            setActiveAiRunId(String(data.runId));
            setSaveMsg(mode === "media_seo"
              ? `Генерация alt и slug: в очереди ${data.queued}…`
              : mode === "split_colors"
              ? "ИИ разделяет фотографии по цветам и сразу создаёт обработанные товары…"
              : mode === "variants"
              ? `Пересборка цветовых семейств: визуальных групп ${data.queued}, по артикулам ${data.deterministic || 0}…`
              : `ИИ: в очереди ${data.queued}, ожидаем обработку…`);
            let finalRun: any = null;
            for (let attempt = 0; attempt < 200; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 3000));
              const run = await getBatchAiRunAction(data.runId);
              if (!run.success) break;
              finalRun = run.data;
              setLatestAiRun(finalRun);
              setAiProgress({
                current: Number(finalRun.completed_count || 0) + Number(finalRun.failed_count || 0),
                total: Number(finalRun.total_count || data.queued),
                failed: Number(finalRun.failed_count || 0),
              });
              setAiQueue(finalRun.queue_items || []);
              setSaveMsg(mode === "media_seo"
                ? `Alt и slug: готово ${finalRun.completed_count || 0} из ${finalRun.total_count || data.queued}, ошибок ${finalRun.failed_count || 0}`
                : mode === "split_colors"
                ? `Разделение по цветам: готово ${finalRun.completed_count || 0}, ошибок ${finalRun.failed_count || 0}`
                : mode === "variants"
                ? `Пересборка семейств: проверено ${finalRun.completed_count || 0} из ${finalRun.total_count || data.queued}`
                : `ИИ: готово ${finalRun.completed_count || 0} из ${finalRun.total_count || data.queued}, ошибок ${finalRun.failed_count || 0}`);
              if (["completed", "failed", "cancelled"].includes(finalRun.status)) break;
            }
            await handleLoadBatch(targetBatchId);
            if (mode === "variants" && finalRun?.status === "completed") setShowAiSuggestions(true);
            setActiveAiRunId(null);
            setSaveMsg(finalRun?.status === "cancelled"
              ? "AI-обработка остановлена. Готовые товары сохранены."
              : finalRun?.status === "completed"
              ? mode === "media_seo"
                ? `✓ Alt и slug сгенерированы: ${finalRun.completed_count || 0}, ошибок ${finalRun.failed_count || 0}. Проверьте результат и нажмите «Обновить каталог».`
                : mode === "split_colors"
                ? `✓ Товар разделён по цветам: варианты созданы, обработаны ИИ и объединены в одну семью`
                : mode === "variants"
                ? `✓ Цветовые семейства пересобраны: по артикулам ${data.deterministic || 0}, визуально ${finalRun.completed_count || 0}`
                : `✓ Обработано ИИ: ${finalRun.completed_count || 0}, ошибок ${finalRun.failed_count || 0}`
              : "ИИ не завершил обработку вовремя. Статус сохранён в истории.");
          }
        } else {
          setSaveMsg(`Ошибка ИИ: ${result.error}`);
        }
      } catch (error: any) {
        setSaveMsg(`Ошибка ИИ: ${error?.message || "не удалось запустить обработку"}`);
      } finally {
        setIsProcessing(false);
        setAiProgress(null);
        setAiQueue([]);
        setTimeout(() => setSaveMsg(null), 5000);
      }
      return;
    }
  };

  const handleStopAi = async () => {
      if (batchId && activeAiRunId) {
        const result = await stopBatchAiRunAction(activeAiRunId);
        if (!result.success) {
          setSaveMsg(`Ошибка остановки ИИ: ${result.error}`);
          return;
        }
        setActiveAiRunId(null);
        setIsProcessing(false);
        setAiProgress(null);
        setSaveMsg("AI-обработка остановлена. Готовые товары сохранены.");
        await handleLoadBatch(batchId);
        return;
      }
  };

  const handleRetryProductAi = async (product: CsvProduct) => {
    if (!batchId || !product.id || isProcessing) return;
    const alreadyProcessed = product.ai_processed === true || product.ai_processed === "true";
    setIsProcessing(true);
    setSaveMsg(`${alreadyProcessed ? "Повторная обработка" : "Обработка ИИ"} ${product.external_id || product.id}...`);
    try {
      const result = await startBatchAiAction(batchId, "retry", Number(product.id));
      if (result.success) {
        const data: any = result.data;
        if (data?.runId) {
          setActiveAiRunId(String(data.runId));
          for (let attempt = 0; attempt < 200; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            const run = await getBatchAiRunAction(data.runId);
            if (!run.success || ["completed", "failed", "cancelled"].includes(run.data?.status)) break;
          }
          setActiveAiRunId(null);
        }
        await handleLoadBatch(batchId);
        setSaveMsg(alreadyProcessed ? "✓ Товар обработан повторно" : "✓ Товар обработан ИИ");
      } else {
        setSaveMsg(result.error || "Ошибка обработки ИИ");
      }
    } finally {
      setActiveAiRunId(null);
      setIsProcessing(false);
      setTimeout(() => setSaveMsg(null), 5000);
    }
  };

  const handleSplitProductColors = async (product: CsvProduct) => {
    if (!batchId || !product.id || isProcessing || product.photos.length < 2) return;
    if (!window.confirm(
      `Разделить товар «${product.name || product.external_id}» по цветам?\n\n` +
      "ИИ за один запрос распределит фотографии, создаст отдельный обработанный товар для каждого цвета и объединит их в одну семью.",
    )) return;
    await handleAiProcess("split_colors", [Number(product.id)]);
  };

  const handleRollbackProductAi = async (product: CsvProduct) => {
    if (!batchId || !product.id || isProcessing) return;
    if (!confirm(`Вернуть товар #${products.indexOf(product) + 1} к состоянию до ИИ?`)) return;
    setIsProcessing(true);
    setSaveMsg(`Откатываем ИИ для ${product.external_id || product.id}...`);
    try {
      const result = await rollbackBatchProductAiAction(batchId, Number(product.id));
      if (!result.success) {
        setSaveMsg(result.error || "Не удалось откатить товар");
        return;
      }
      await handleLoadBatch(batchId);
      setSaveMsg("✓ Товар возвращён к состоянию до ИИ");
    } finally {
      setIsProcessing(false);
      setTimeout(() => setSaveMsg(null), 5000);
    }
  };

  const handleCustomScriptProcess = async () => {
    if (!supplierId || !scriptBatchId) return;
    setIsRunningCustomScript(true);
    setSaveMsg("Запуск скрипта...");
    
    const res = await runCustomSupplierScriptAction(localPath || null, supplierId, scriptBatchId);
    
    if (res.success && res.path) {
        setBatchId(scriptBatchId);
        setActiveSnapshotId(null);
        await handleLoadBatch(scriptBatchId);
        setSaveMsg("✓ Скрипт успешно отработал!");
        setTimeout(() => setSaveMsg(null), 5000);
    } else {
        alert("Ошибка выполнения скрипта: " + res.error);
        setSaveMsg(null);
    }
    
    setIsRunningCustomScript(false);
  };

  const updateProduct = useCallback(
    (index: number, field: keyof CsvProduct, value: any) => {
      if (isSnapshotSource) {
        setSaveMsg('Исторический снимок доступен только для просмотра');
        return;
      }
      const currentProduct = products[index];
      setProducts((prev) =>
        prev.map((p, i) => (i === index ? { ...p, [field]: value, ...(field === 'price' ? { price_source: 'manual' } : {}) } : p)),
      );
      setIsDirty(true);
      if (batchId && currentProduct) {
        const identifier = currentProduct.id || currentProduct.external_id;
        if (identifier) {
          const timerKey = `${batchId}:${identifier}:${field}`;
          const previousTimer = batchUpdateTimers.current.get(timerKey);
          if (previousTimer) clearTimeout(previousTimer);
          const timer = setTimeout(() => {
            updateBatchProductAction(identifier, { [field]: value } as Partial<CsvProduct>, batchId)
                .then((res) => {
                  if (res.success) {
                  if (batchUpdateTimers.current.size <= 1) setIsDirty(false);
                  setSaveMsg("✓ Сохранено в БД");
                  setTimeout(() => setSaveMsg(null), 2500);
                } else {
                  setSaveMsg("✗ Ошибка БД: " + (res.error || "unknown"));
                }
              })
              .catch((error) => setSaveMsg("✗ Ошибка БД: " + error.message))
              .finally(() => batchUpdateTimers.current.delete(timerKey));
          }, 500);
          batchUpdateTimers.current.set(timerKey, timer);
        }
      }
    },
    [batchId, isSnapshotSource, products],
  );

  const handleRemove = useCallback((index: number) => {
    if (isSnapshotSource) {
      setSaveMsg('Исторический снимок доступен только для просмотра');
      return;
    }
    const productToRemove = products[index];
    const nextProducts = products.filter((_, i) => i !== index);
    setProducts(nextProducts);
    setIsDirty(true);
    if (batchId && productToRemove) {
      const identifier = productToRemove.id || productToRemove.external_id;
      if (identifier) {
        deleteBatchProductAction(identifier, batchId)
          .then((res) => {
            if (res.success) {
              setIsDirty(false);
              setSaveMsg("✓ Удалено из БД");
              setTimeout(() => setSaveMsg(null), 2500);
            } else {
              setSaveMsg("✗ Ошибка БД: " + (res.error || "unknown"));
            }
          })
          .catch((error) => setSaveMsg("✗ Ошибка БД: " + error.message));
      }
    }
    setSelectedIdx((prev) => {
      if (prev === index) return null;
      if (prev !== null && prev > index) return prev - 1;
      return prev;
    });
    setSelectedForMerge((prev) =>
      prev
        .filter((selectedIndex) => selectedIndex !== index)
        .map((selectedIndex) =>
          selectedIndex > index ? selectedIndex - 1 : selectedIndex,
        ),
    );
  }, [batchId, isSnapshotSource, products]);

  const handleClear = () => {
    setProducts([]);
    setFileName("");
    setResult(null);
    setSelectedIdx(null);
    setIsDirty(false);
    setSaveMsg(null);
    setFilterBrand("");
    setFilterCategory("");
    setFilterSubcategory("");
    setFilterGender("");
    setBulkBrand("");
    setBulkCategory("");
    setBulkSubcategory("");
    setBulkPrice("");
    setSelectedForMerge([]);
    setPreviousProducts(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const toggleMergeSelection = useCallback((index: number, shiftKey = false) => {
    const visibleIndices = displayedProducts.map((product) => products.indexOf(product)).filter((value) => value >= 0);
    const anchor = selectionAnchorRef.current;
    setSelectedForMerge((prev) => {
      if (shiftKey && anchor !== null) {
        const anchorPosition = visibleIndices.indexOf(anchor);
        const currentPosition = visibleIndices.indexOf(index);
        if (anchorPosition >= 0 && currentPosition >= 0) {
          const [from, to] = anchorPosition < currentPosition
            ? [anchorPosition, currentPosition]
            : [currentPosition, anchorPosition];
          return [...new Set([...prev, ...visibleIndices.slice(from, to + 1)])];
        }
      }
      if (prev.includes(index)) return prev.filter((i) => i !== index);
      return [...prev, index];
    });
    selectionAnchorRef.current = index;
  }, [displayedProducts, products]);

  const handleSelectFiltered = () => {
    setSelectedForMerge(filteredProducts.map((product) => products.indexOf(product)));
    selectionAnchorRef.current = filteredProducts.length ? products.indexOf(filteredProducts[0]) : null;
  };

  const handleRetryFailedAi = async () => {
    const ids = aiErrorProducts
      .map((product) => Number(product.id))
      .filter(Number.isInteger);
    if (!ids.length) return;
    await handleAiProcess("selection", ids);
  };

  const handleReprocessAll = async () => {
    if (!window.confirm(
      `Повторно обработать ИИ все ${products.length} товаров?\n\n` +
      "Перед запуском будет создан снимок. Текущие цены сохранятся, а SEO, классификация, атрибуты и медиарешения будут рассчитаны заново.",
    )) return;
    setShowMoreActions(false);
    await handleAiProcess("reprocess");
  };

  const handleRecoverMeasurements = async () => {
    setShowMoreActions(false);
    await handleAiProcess("recover_measurements");
  };

  const handleRollbackAiSample = async () => {
    const targetBatchId = batchId || initialBatchId;
    if (!targetBatchId || isRollingBackAiSample) return;
    if (!window.confirm(
      `Отменить тестовую AI-обработку ${aiSampleCount || 10} товаров?\n\n` +
      "Партия вернётся к снимку перед последним тестом ИИ. Ручные изменения, сделанные после теста, тоже будут отменены.",
    )) return;

    setIsRollingBackAiSample(true);
    try {
      const snapshotsResult = await getBatchSnapshotsAction(targetBatchId);
      const snapshot = snapshotsResult.success
        ? snapshotsResult.data?.find((item: any) => item.label === "До AI · sample")
        : null;
      if (!snapshot) {
        setSaveMsg("Не найден снимок перед тестом ИИ. Используйте откат из истории выгрузки.");
        return;
      }

      const rollbackResult = await rollbackBatchAction(targetBatchId, snapshot.id);
      if (!rollbackResult.success) {
        setSaveMsg(`Ошибка отката: ${rollbackResult.error}`);
        return;
      }

      await handleLoadBatch(targetBatchId);
      setSaveMsg("✓ Тестовая AI-обработка отменена, партия восстановлена из снимка.");
    } catch (error: any) {
      setSaveMsg(`Ошибка отката: ${error?.message || "не удалось восстановить снимок"}`);
    } finally {
      setIsRollingBackAiSample(false);
    }
  };

  const handleBulkApply = () => {
    if (isSnapshotSource) return;
    const updates: Partial<CsvProduct> = {};
    if (bulkBrand) updates.brand = bulkBrand;
    if (bulkCategory) updates.category = bulkCategory;
    if (bulkSubcategory) updates.subcategory = bulkSubcategory;
    if (bulkPrice !== "") {
      const price = Number(bulkPrice);
      if (!Number.isFinite(price) || price < 0) {
        setSaveMsg("Цена должна быть числом не меньше 0");
        return;
      }
      updates.price = price;
      updates.price_source = "manual";
    }
    if (Object.keys(updates).length === 0 || selectedForMerge.length === 0) return;

    setPreviousProducts([...products]);
    setProducts((prev) =>
      {
        const next = prev.map((product, index) =>
          selectedForMerge.includes(index) ? { ...product, ...updates } : product,
        );
        if (batchId) persistBatchProducts(next);
        return next;
      },
    );
    setSelectedForMerge([]);
    setBulkBrand("");
    setBulkCategory("");
    setBulkSubcategory("");
    setBulkPrice("");
    setIsDirty(true);
  };

  const handleMergePhotos = () => {
    if (isSnapshotSource) return;
    if (selectedForMerge.length < 2) return;

    // Сохраняем состояние для отмены
    setPreviousProducts([...products]);

    const targetIdx = selectedForMerge[0];
    const sourceIndices = selectedForMerge.slice(1);

    // Собираем все фото по порядку выбора
    const allPhotos: string[] = [];
    selectedForMerge.forEach((idx) => {
      products[idx].photos.forEach((url) => {
        if (!allPhotos.includes(url)) allPhotos.push(url);
      });
    });

    setProducts((prev) => {
      const next = [...prev];
      // Обновляем первый выбранный товар новыми фото
      next[targetIdx] = { ...next[targetIdx], photos: allPhotos };

      // Удаляем остальные товары (сортируем индексы в обратном порядке, чтобы не сбить порядок при удалении)
      const sortedIndicesToRemove = [...sourceIndices].sort((a, b) => b - a);
      sortedIndicesToRemove.forEach((idx) => {
        next.splice(idx, 1);
      });
      if (batchId) persistBatchProducts(next);
      return next;
    });

    setSelectedForMerge([]);
    setIsDirty(true);
  };

  const handleUndoMerge = () => {
    if (isSnapshotSource) return;
    if (previousProducts) {
      setProducts(previousProducts);
      setPreviousProducts(null);
      setIsDirty(true);
      if (batchId) persistBatchProducts(previousProducts);
    }
  };

  const handleUndoChanges = async () => {
    if (isSnapshotSource) return;
    if (previousProducts) {
      handleUndoMerge();
      return;
    }
    if (batchId) {
      const result = await getBatchProductsAction(batchId);
      if (result.success && result.data) {
        setProducts(result.data.products);
        setIsDirty(false);
        setSaveMsg("✓ Изменения отменены");
      }
      return;
    }
    if (localPath) await handleLoadPath(localPath);
  };

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-900 font-sans text-slate-200">
      {saveMsg && (
        <div className={`fixed bottom-6 right-6 z-[220] max-w-lg rounded-xl border px-4 py-3 text-sm font-semibold shadow-2xl ${
          saveMsg.startsWith("✓")
            ? "border-emerald-500/30 bg-emerald-950 text-emerald-200"
            : saveMsg.startsWith("Ошибка") || saveMsg.startsWith("✗")
              ? "border-red-500/30 bg-red-950 text-red-200"
              : "border-indigo-500/30 bg-slate-950 text-indigo-200"
        }`}>
          {saveMsg}
        </div>
      )}
      <div className="mx-auto max-w-[1800px] p-3 sm:p-4">
        {(onClose || backHref) && (
          <div className="mb-3 flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800/70 px-4 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold text-white">Товары выгрузки</h2>
              <p className="truncate text-xs text-slate-500">{initialSupplierName || 'Поставщик не указан'}{products.length ? ` · ${products.length} товаров` : ''}{sourceLabel ? ` · ${sourceLabel}` : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              {isSnapshotSource && initialBatchId && (
                <button
                  onClick={handleOpenCurrentBatch}
                  className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm font-semibold text-indigo-200 transition-colors hover:bg-indigo-500/20"
                >
                  Редактировать текущую версию
                </button>
              )}
              {backHref ? (
                <Link href={backHref} className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-700">
                  <X size={18} />
                  К истории
                </Link>
              ) : (
                <button
                  onClick={onClose}
                  className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-700"
                >
                  <X size={18} />
                  Закрыть
                </button>
              )}
            </div>
          </div>
        )}

        {(publishOperation?.running || publishOperation?.stale) && publishProgress && (
          <div className={`mb-4 rounded-xl border p-4 ${publishOperation.stale ? "border-amber-500/35 bg-amber-950/30" : "border-emerald-500/30 bg-emerald-950/25"}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {publishOperation.stale
                    ? <AlertTriangle className="h-5 w-5 text-amber-300" />
                    : <RefreshCw className={`h-5 w-5 text-emerald-300 ${publishOperation.cancelling ? "" : "animate-spin"}`} />}
                  <span className="font-bold text-white">
                    {publishOperation.stale
                      ? "Публикация была прервана"
                      : publishOperation.cancelling
                        ? "Останавливаем публикацию"
                        : publishProgress.phase === "lookup"
                          ? "Проверяем товары в каталоге"
                          : publishProgress.phase === "media"
                            ? "Переносим фотографии"
                            : "Публикуем товары"}
                  </span>
                  <span className="rounded-full bg-slate-950/60 px-2.5 py-1 text-sm font-bold text-slate-200">{publishProgress.current}/{publishProgress.total}</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-950/70">
                  <div
                    className={`h-full rounded-full transition-all ${publishOperation.stale ? "bg-amber-400" : "bg-emerald-400"}`}
                    style={{ width: `${publishProgress.total > 0 ? Math.min(100, (publishProgress.current / publishProgress.total) * 100) : 0}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  {publishOperation.stale
                    ? "Процесс перестал обновляться. Сбросьте блокировку и безопасно запустите публикацию повторно."
                    : "Можно закрыть страницу: состояние и счётчик сохраняются на сервере."}
                </p>
              </div>
              <button
                onClick={handleStopPublish}
                disabled={isStoppingPublish || publishOperation.cancelling}
                className={`shrink-0 rounded-lg border px-4 py-2 text-sm font-bold transition-colors disabled:opacity-50 ${publishOperation.stale ? "border-amber-400/40 text-amber-200 hover:bg-amber-500/10" : "border-red-400/40 text-red-200 hover:bg-red-500/10"}`}
              >
                {isStoppingPublish ? "Подождите…" : publishOperation.stale ? "Сбросить операцию" : publishOperation.cancelling ? "Остановка…" : "Остановить"}
              </button>
            </div>
          </div>
        )}
        
        {/* Global Action Bar (only when products are loaded) */}
        {products.length > 0 && (
          <div ref={actionBarRef} className="sticky top-0 z-30 mb-2 flex flex-col items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-800 p-3 shadow-xl md:flex-row">
            <div className="flex items-center gap-4">
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Выбрано</span>
                <span className="text-base font-bold text-white">
                  {products.length} <span className="text-xs font-normal text-slate-400">товаров</span>
                </span>
              </div>
              
              <div className="h-10 w-px bg-slate-700 mx-2 hidden md:block" />

              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Обработка</span>
                <span className="flex items-center gap-2 text-sm font-bold">
                  <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle size={14} /> {aiReadyCount} готово</span>
                  <span className="text-slate-600">/</span>
                  <span className="inline-flex items-center gap-1 text-amber-400"><AlertTriangle size={14} /> {aiRemainingCount} сырых</span>
                </span>
              </div>
              
              {initialSupplierName && (
                <>
                  <div className="h-10 w-px bg-slate-700 mx-2 hidden md:block" />
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-600 bg-slate-700">
                      {initialSupplierAvatar ? (
                        <img src={initialSupplierAvatar} alt={initialSupplierName} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-sm font-bold text-slate-400">
                          {initialSupplierName.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Поставщик</span>
                      <span className="text-sm font-bold text-white leading-tight">{initialSupplierName}</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto justify-end">
              {(importMode === "local" || isBatchSource) && isDirty && !isSnapshotSource && (
                <div className="flex flex-col items-center relative">
                  <button
                    onClick={handleSaveToFile}
                    disabled={isSaving || !isDirty}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${isDirty
                        ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20"
                        : "bg-slate-700/50 text-slate-500 cursor-not-allowed"
                      }`}
                  >
                    <Save className="w-4 h-4" />
                    {isSaving ? "Сохраняю..." : isBatchSource ? "Сохранить БД" : "Сохранить файл"}
                  </button>
                  <button
                    onClick={handleUndoChanges}
                    disabled={isSaving}
                    className="mt-1 px-2 py-1 text-[11px] font-medium text-slate-400 hover:text-white disabled:opacity-50"
                  >
                    Отменить изменения
                  </button>
                </div>
              )}

              {!isBatchSource && !isSnapshotSource && (
                <button
                  onClick={handleClear}
                  className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                >
                  Очистить
                </button>
              )}

              {supplierData?.post_process_script && batchStage === "SCRAPED" && scriptBatchId && (
                <button
                  onClick={handleCustomScriptProcess}
                  disabled={isRunningCustomScript}
                  className="flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-amber-600/20 transition-all hover:bg-amber-500 disabled:opacity-50"
                  title={`Скрипт: ${supplierData.post_process_script}`}
                >
                  {isRunningCustomScript ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Filter className="h-4 w-4" />}
                  Пост-обработка скриптом
                </button>
              )}

              {isSnapshotSource && initialBatchId && ["SCRIPT_PROCESSED", "AI_PROCESSED", "PUSHED"].includes(batchStage) && aiRemainingCount === 0 && (
                <button
                  onClick={() => handlePush("upsert")}
                  disabled={isPushing || Boolean(publishOperation?.running || publishOperation?.stale)}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 transition-all hover:bg-emerald-500 disabled:opacity-50"
                  title="Обновить Rails-каталог данными этого snapshot и удалить товары этой партии, которых в нём нет"
                >
                  {isPushing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Пушить этот snapshot в каталог
                </button>
              )}

              {!isSnapshotSource && isBatchSource && aiSampleCount > 0 && batchStage !== "PUSHED" && !isProcessing && (
                <button
                  onClick={handleRollbackAiSample}
                  disabled={isRollingBackAiSample}
                  className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-bold text-amber-200 transition-all hover:bg-amber-500/20 disabled:opacity-50"
                  title="Вернуть партию к снимку перед последним тестом ИИ"
                >
                  {isRollingBackAiSample ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                  Отменить тест ИИ · {aiSampleCount}
                </button>
              )}

              {!isSnapshotSource && (batchStage === "PUSHED" && !isProcessing ? (
                <div className="flex flex-wrap items-center gap-2">
                  {canGenerateMediaSeo && (
                    <button
                      onClick={() => handleAiProcess("media_seo")}
                      disabled={isPushing || Boolean(publishOperation?.running || publishOperation?.stale)}
                      className="inline-flex items-center gap-2 rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-2.5 text-sm font-bold text-violet-200 transition-all hover:bg-violet-500/20 disabled:opacity-50"
                      title="Перезаписать alt-тексты, slug товара и имена файлов фото для последней выгрузки"
                    >
                      <Sparkles className="h-4 w-4" /> Сгенерировать alt + slug
                    </button>
                  )}
                  <button
                    onClick={() => handlePush("upsert")}
                    disabled={isPushing || Boolean(publishOperation?.running || publishOperation?.stale)}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 transition-all hover:bg-emerald-500 disabled:opacity-50"
                    title="Отправить в каталог только товары, изменённые после предыдущей публикации; после генерации alt и slug фото будут перевыложены в WebP с новыми именами"
                  >
                    {isPushing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {mediaSeoProducts.length > 0 ? "Обновить каталог" : "Обновить изменённые"}
                  </button>
                  <button
                    onClick={handleReprocessAll}
                    disabled={isProcessing}
                    className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-2.5 text-sm font-bold text-indigo-200 transition-all hover:bg-indigo-500/20 disabled:opacity-50"
                    title="Создать снимок и заново применить актуальные AI-настройки ко всей партии"
                  >
                    <RefreshCw className="h-4 w-4" /> Переобработать ИИ
                  </button>
                  <span className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-bold text-emerald-300">
                    <CheckCircle className="h-4 w-4" /> Запушено в БД
                  </span>
                </div>
              ) : !canPublish || isProcessing ? (
                isProcessing ? (
                  <button
                      onClick={handleStopAi}
                      className="px-6 py-2.5 text-sm font-bold bg-red-600 hover:bg-red-500 text-white rounded-xl transition-all shadow-lg shadow-red-600/20 flex items-center gap-2"
                  >
                      <Square className="w-4 h-4 fill-current" />
                      Стоп ИИ ({aiProgress ? `${aiProgress.current}/${aiProgress.total}` : "..."})
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    {isBatchSource && aiReadyCount > 0 && aiRemainingCount > 0 && (
                      <button
                        onClick={() => handleAiProcess("sample")}
                        className="flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-2.5 text-sm font-bold text-indigo-200 transition-all hover:bg-indigo-500/20"
                        title="Обработать 10 ещё сырых товаров с текущими глобальными настройками"
                      >
                        <Sparkles className="h-4 w-4" />
                        Новый тест · 10
                      </button>
                    )}
                    <button
                        onClick={() => handleAiProcess(aiReadyCount > 0 ? "full" : "sample")}
                        className="px-6 py-2.5 text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center gap-2"
                    >
                        <Zap className="w-4 h-4 text-amber-300 fill-amber-300" />
                        {aiReadyCount > 0
                          ? "Обработать с ИИ остальные"
                          : "Тест ИИ · 10 товаров"}
                    </button>
                  </div>
                )
              ) : (
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <button
                      onClick={() => setShowPublishMenu((value) => !value)}
                      disabled={isPushing || Boolean(publishOperation?.running || publishOperation?.stale)}
                      className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition-all hover:from-emerald-400 hover:to-teal-500 disabled:opacity-50"
                    >
                      {(isPushing || publishOperation?.running) ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {(isPushing || publishOperation?.running) && publishProgress
                        ? `${publishProgress.phase === "lookup" ? "Проверка" : publishProgress.phase === "media" ? "Фото" : "Публикация"} ${publishProgress.current}/${publishProgress.total}`
                        : "Публикация"}
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    {showPublishMenu && (
                      <div className="absolute right-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 p-1 shadow-2xl">
                        <button onClick={() => { setShowPublishMenu(false); handlePush("upsert", true) }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-emerald-200 hover:bg-slate-800">
                          <span className="block font-semibold">Заменить каталог текущей версией</span>
                          <span className="text-xs text-slate-500">Обновить товары, добавить новые и удалить отсутствующие в текущей БД-версии</span>
                        </button>
                        <button onClick={() => { setShowPublishMenu(false); handlePush("upsert") }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-white hover:bg-slate-800">
                          <span className="block font-semibold">Обновить и добавить</span>
                          <span className="text-xs text-slate-500">Совпавшие external_id обновить, остальные добавить</span>
                        </button>
                        <button onClick={() => { setShowPublishMenu(false); handlePush("add") }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-white hover:bg-slate-800">
                          <span className="block font-semibold">Добавить только новые</span>
                          <span className="text-xs text-slate-500">Совпавшие external_id пропустить</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isBatchSource && (
                <div className="relative">
                  <button onClick={() => setShowMoreActions((value) => !value)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-700" title="Дополнительные действия">
                    <MoreHorizontal className="h-5 w-5" />
                  </button>
                  {showMoreActions && (
                    <div className="absolute right-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 p-1 shadow-2xl">
                      <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">Настройки</div>
                      {supplierId && <Link href={`/admin/suppliers?supplier=${supplierId}`} target="_blank" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"><Users className="h-4 w-4" />Настройки поставщика</Link>}
                      <Link href="/admin/ai-rules" target="_blank" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"><Settings2 className="h-4 w-4" />Настройки ИИ</Link>
                      <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">Изменения и AI</div>
                      {(previousProducts || isDirty) && <button onClick={handleUndoChanges} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"><RefreshCw className="h-4 w-4" />Отменить изменения</button>}
                      {batchStage === "PUSHED" && <button onClick={handleRecoverMeasurements} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-emerald-300 hover:bg-slate-800"><RefreshCw className="h-4 w-4" />Восстановить таблицы замеров<span className="block text-xs text-slate-500">Только товары с фото таблиц</span></button>}
                      {batchStage === "AI_PROCESSED" && <button onClick={handleReprocessAll} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-indigo-300 hover:bg-slate-800"><RefreshCw className="h-4 w-4" />Переобработать ИИ всю партию</button>}
                      {aiReadyCount >= 2 && <button onClick={() => handleAiProcess("variants")} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-violet-300 hover:bg-slate-800"><Merge className="h-4 w-4" />Пересобрать цветовые семьи</button>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        {/* Input Area */}
        {isBatchSource && pendingAiSuggestions.length > 0 && (
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-violet-500/30 bg-violet-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="rounded-lg bg-violet-500/15 p-2 text-violet-300">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-white">Предложения ИИ</h3>
                  <span className="rounded-full border border-violet-400/30 bg-violet-500/15 px-2 py-0.5 text-xs font-bold text-violet-200">
                    {pendingAiSuggestions.length} ожидают решения
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-slate-400">
                  {pendingAiSuggestions.slice(0, 5).map((item) => item.payload?.name || item.payload?.label || item.canonical_key).join(" · ")}
                  {pendingAiSuggestions.length > 5 ? ` · ещё ${pendingAiSuggestions.length - 5}` : ""}
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowAiSuggestions(true)}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-violet-500"
            >
              <Sparkles className="h-4 w-4" />
              Открыть предложения
            </button>
          </div>
        )}

        {/* Input Area */}
        {products.length === 0 && !isBatchSource && (
          <div className="max-w-2xl mx-auto mb-10">
            {importMode === "upload" ? (
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-600 hover:border-emerald-500 hover:bg-slate-800/50 rounded-2xl p-12 text-center cursor-pointer transition-all group"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={(e) =>
                    e.target.files?.[0] && handleFile(e.target.files[0])
                  }
                  className="hidden"
                />
                <div className="w-16 h-16 mx-auto mb-4 bg-slate-800 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Upload className="w-8 h-8 text-slate-400 group-hover:text-emerald-400 transition-colors" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  Загрузить CSV файл
                </h3>
                <p className="text-sm text-slate-400">
                  Перетащите файл сюда или нажмите для выбора
                </p>
              </div>
            ) : (
              <div className="bg-slate-800 rounded-2xl p-8 border border-slate-700 shadow-xl">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-3 bg-indigo-500/10 rounded-xl">
                    <HardDrive className="w-6 h-6 text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      Локальный файл
                    </h3>
                    <p className="text-sm text-slate-400">
                      Откройте CSV файл, отредактируйте и сохраните
                    </p>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">
                    Путь к CSV файлу
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <FolderOpen className="absolute left-3 top-2.5 w-5 h-5 text-slate-500" />
                      <input
                        type="text"
                        value={localPath}
                        onChange={(e) => setLocalPath(e.target.value)}
                        placeholder="C:\projects\data.csv"
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-600 rounded-xl text-white focus:border-indigo-500 outline-none transition-all font-mono text-sm"
                        onKeyDown={(e) => e.key === "Enter" && loadFromPath()}
                      />
                    </div>
                    <button
                      id="load-local-btn"
                      onClick={loadFromPath}
                      disabled={isLoadingPath || !localPath}
                      className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      {isLoadingPath ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        "Открыть"
                      )}
                    </button>
                  </div>
                  {pathError && (
                    <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 p-3">
                      <p className="text-sm text-red-300 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" /> {pathError}
                      </p>
                    </div>
                  )}
                  <p className="mt-3 text-xs text-slate-500">
                    Редактируйте данные, затем нажмите кнопку «Сохранить в файл»
                    в шапке.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Result */}
        {result && (
          <div
            id="import-result"
            className={`mb-6 p-5 rounded-2xl border shadow-xl animate-in fade-in slide-in-from-top-4 duration-500 ${result.failed === 0
                ? "bg-emerald-900/20 border-emerald-500/30"
                : result.success === 0
                  ? "bg-red-900/20 border-red-500/30"
                  : "bg-amber-900/20 border-amber-500/30"
              }`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {result.failed === 0 ? (
                  <div className="p-2 bg-emerald-500/20 rounded-lg">
                    <CheckCircle className="w-6 h-6 text-emerald-400" />
                  </div>
                ) : (
                  <div className="p-2 bg-red-500/20 rounded-lg">
                    <AlertTriangle className="w-6 h-6 text-red-400" />
                  </div>
                )}
                <div>
                  <h3 className="text-lg font-bold text-white">
                    Результаты публикации
                  </h3>
                  <p className="text-sm text-slate-400">
                    Добавлено:{" "}
                    <span className="text-emerald-400 font-bold">
                      {result.success}
                    </span>{" "}
                    | Обновлено:{" "}
                    <span className="text-cyan-400 font-bold">
                      {result.updated}
                    </span>{" "}
                    | Пропущено:{" "}
                    <span className="text-slate-300 font-bold">
                      {result.skipped}
                    </span>{" "}
                    | Ошибки:{" "}
                    <span className="text-red-400 font-bold">
                      {result.failed}
                    </span>
                  </p>
                </div>
              </div>

              {result.errors.length > 0 && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(result.errors.join("\n"));
                    alert("Логи ошибок скопированы в буфер обмена");
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors border border-slate-700"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  Копировать ошибки
                </button>
              )}
            </div>

            {result.errors.length > 0 && (
              <div className="bg-black/40 rounded-xl p-4 border border-slate-800/50">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-3">
                  Лог ошибок
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar font-mono text-xs">
                  {result.errors.map((err, i) => (
                    <div
                      key={i}
                      className="flex gap-3 text-red-300 leading-relaxed bg-red-500/5 p-2 rounded border border-red-500/10 hover:border-red-500/30 transition-colors"
                    >
                      <span className="text-red-500/50 flex-shrink-0">
                        {i + 1}.
                      </span>
                      <span>{err}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* File Info Bar */}
        {products.length > 0 && fileName && !isBatchSource && (
          <div className="mb-6 flex items-center justify-between p-3 bg-slate-800 rounded-xl border border-slate-700">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-lg ${importMode === "local" ? "bg-indigo-500/10 text-indigo-400" : "bg-emerald-500/10 text-emerald-400"}`}
              >
                {importMode === "local" ? (
                  <HardDrive className="w-4 h-4" />
                ) : (
                  <FileSpreadsheet className="w-4 h-4" />
                )}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-medium text-white">{fileName}</h4>
                  {sourceLabel && (
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                      sourceLabel.includes('БД')
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    }`}>
                      {sourceLabel}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {importMode === "local"
                    ? isBatchSource ? "Редактирование товаров партии в Scraping DB" : "Редактирование локального файла"
                    : "Просмотр перед импортом"}
                </p>
              </div>
            </div>
            {(importMode === "local" || isBatchSource) && isDirty && (
              <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-xs font-medium text-amber-400">
                  Есть несохранённые изменения
                </span>
              </div>
            )}
          </div>
        )}

        {isBatchSource && ((isProcessing && aiProgress) || (showAiLogs && isMediaSeoRun) || mediaSeoRunFinished) && (
          <div className="mb-4 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 font-bold text-white">
                  <Sparkles className="h-4 w-4 text-indigo-300" />
                  {isMediaSeoRun ? "Очередь alt + slug" : "Очередь обработки ИИ"}
                </div>
                {aiProgress ? (
                  <div className="mt-1 text-xs text-slate-400">
                    Завершено {aiProgress.current} из {aiProgress.total}
                    {aiProgress.failed > 0 ? ` · ошибок ${aiProgress.failed}` : ""}
                    {` · осталось ${Math.max(0, aiProgress.total - aiProgress.current)}`}
                  </div>
                ) : latestAiRun ? (
                  <div className="mt-1 text-xs text-slate-400">
                    {isMediaSeoRun ? "Генерация alt + slug завершена" : "Запуск завершён"}: {latestAiRun.completed_count || 0} из {latestAiRun.total_count || 0}
                    {latestAiRun.failed_count > 0 ? ` · ошибок ${latestAiRun.failed_count}` : ""}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {isMediaSeoRun && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowAiErrors((current) => !current)}
                      disabled={!latestAiRun?.errors?.length}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 px-2.5 py-1.5 text-xs font-bold text-red-200 hover:bg-red-500/10 disabled:opacity-50"
                      title="Показать товары, для которых alt и slug не сгенерировались"
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {showAiErrors ? "Скрыть ошибки" : `Показать ошибки${latestAiRun?.errors?.length ? ` (${latestAiRun.errors.length})` : ""}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAiProcess("media_seo", (latestAiRun?.errors || []).map((item: any) => Number(item.product_id)).filter(Number.isInteger))}
                      disabled={isProcessing || !latestAiRun?.errors?.some((item: any) => Number.isInteger(Number(item.product_id)))}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/30 px-2.5 py-1.5 text-xs font-bold text-amber-100 hover:bg-amber-500/10 disabled:opacity-50"
                      title="Повторно сгенерировать alt и slug только для товаров с ошибкой"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Повторить ошибки
                    </button>
                  </>
                )}
                {isMediaSeoRun && (
                  <button
                    type="button"
                    onClick={toggleAiLogs}
                    disabled={!activeAiRunId && !latestAiRun?.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-400/30 px-2.5 py-1.5 text-xs font-bold text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-50"
                    title="Открыть журнал генерации alt и slug"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {showAiLogs ? "Скрыть логи" : "Логи alt + slug"}
                  </button>
                )}
                {aiProgress && (
                  <div className="h-2 w-48 overflow-hidden rounded-full bg-slate-900">
                    <div
                      className="h-full rounded-full bg-indigo-500 transition-all"
                      style={{ width: `${aiProgress.total ? Math.min(100, aiProgress.current / aiProgress.total * 100) : 0}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
            {aiQueue.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {aiQueue.map((item) => {
                  const photo = Array.isArray(item.photos) ? item.photos[0] : null;
                  return (
                    <div key={`${item.product_id}-${item.status}`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-600 bg-slate-900" title={item.name || item.external_id}>
                      <AiQueuePhoto photo={photo} />
                      <span className={`absolute bottom-1 right-1 h-2 w-2 rounded-full ${item.status === "running" ? "animate-pulse bg-emerald-400" : "bg-amber-400"}`} />
                    </div>
                  );
                })}
              </div>
            )}
            {showAiLogs && (
              <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950/70 p-3 text-xs">
                {isLoadingAiLogs ? (
                  <div className="text-slate-500">Загружаю журнал…</div>
                ) : aiLogs.length === 0 ? (
                  <div className="text-slate-500">Записей пока нет.</div>
                ) : (
                  <div className="space-y-1.5 font-mono">
                    {aiLogs.map((item) => (
                      <div key={`${item.product_id}-${item.created_at}`} className="flex flex-wrap gap-x-2 gap-y-0.5 border-b border-slate-800 pb-1.5 last:border-0">
                        <span className={item.status === "failed" ? "text-red-300" : item.status === "completed" ? "text-emerald-300" : "text-amber-300"}>
                          {item.status}
                        </span>
                        <span className="text-slate-300">#{item.product_id || "?"}</span>
                        <span className="text-slate-400">{item.external_id || item.name || "без ID"}</span>
                        {item.status === "completed" && item.slug && (
                          <span className="text-indigo-200">slug: {item.slug} · alt: {Array.isArray(item.photo_alts) ? item.photo_alts.length : 0}</span>
                        )}
                        {item.error_message && <span className="text-red-300">— {item.error_message}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {showAiErrors && isMediaSeoRun && (
              <div className="mt-3 rounded-lg border border-red-500/25 bg-red-950/20 p-3 text-xs">
                {!latestAiRun?.errors?.length ? (
                  <div className="text-slate-500">Ошибок в этом запуске нет.</div>
                ) : (
                  <div className="space-y-1.5">
                    {latestAiRun.errors.map((item: any) => (
                      <div key={`${item.product_id}-${item.updated_at}`} className="flex flex-wrap gap-x-2 gap-y-0.5 border-b border-red-950/50 pb-1.5 text-red-100 last:border-0">
                        <span className="font-mono text-red-300">#{item.product_id || "?"}</span>
                        <span>{item.name || item.external_id || "Товар без названия"}</span>
                        {item.external_id && <span className="text-slate-500">{item.external_id}</span>}
                        <span className="text-red-300">— {item.error_message || "Неизвестная ошибка"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {isBatchSource && !isProcessing && aiErrorProducts.length > 0 && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 font-bold text-white">
                  <AlertTriangle className="h-4 w-4 text-red-300" />
                  Не обработано ИИ: {aiErrorProducts.length}
                  {latestAiRun && (
                    <span className="rounded-full border border-slate-600 bg-slate-900/60 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                      {latestAiRun.provider} · {latestAiRun.status} · запуск {String(latestAiRun.id || "").slice(0, 8)}
                    </span>
                  )}
                </div>
                <div className="mt-2 space-y-1 text-xs text-red-200">
                  {aiErrorGroups.slice(0, 4).map(([message, count]) => (
                    <div key={message}><span className="font-bold">{count} шт.</span> — {message}</div>
                  ))}
                </div>
                {Array.isArray(latestAiRun?.errors) && latestAiRun.errors.length > 0 && (
                  <details className="mt-3 text-xs text-slate-400">
                    <summary className="cursor-pointer font-semibold text-slate-300">Подробный журнал последнего запуска</summary>
                    <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950/60 p-3 font-mono">
                      {latestAiRun.errors.slice(0, 50).map((item: any) => (
                        <div key={`${item.product_id}-${item.external_id}`}>
                          #{item.product_id} · {item.external_id || "без external_id"} · попыток {Number(item.attempts || 0)} · {item.error_message}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  onClick={() => setFilterAiStatus("error")}
                  className="rounded-lg border border-red-400/30 px-3 py-2 text-xs font-bold text-red-200 hover:bg-red-500/10"
                >
                  Показать товары
                </button>
                <button
                  onClick={handleRetryFailedAi}
                  disabled={!batchId}
                  className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-50"
                >
                  Повторить ошибки · {aiErrorProducts.length}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        {products.length > 0 && (
            <div
              className="sticky z-20 mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-800/95 p-4 shadow-xl backdrop-blur-md"
              style={{ top: actionBarHeight + 8 }}
            >
              <div className="flex items-center gap-2 text-slate-500 mr-1">
                <Filter className="w-4 h-4" />
                <span className="text-xs font-medium uppercase tracking-wider">
                  Фильтры
                </span>
              </div>

              {uniqueBrands.length > 0 && (
                <select
                  value={filterBrand}
                  onChange={(e) => setFilterBrand(e.target.value)}
                  className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500 transition-colors min-w-[160px]"
                >
                  <option value="">Все бренды ({products.length})</option>
                  {uniqueBrands.map((id) => (
                    <option key={id} value={id}>
                      {id === "__EMPTY__"
                        ? `Без бренда (${brandCounts.get("__EMPTY__") || 0})`
                        : `${resolveName(id, lookups?.brands || [])} (${brandCounts.get(id) || 0})`}
                    </option>
                  ))}
                </select>
              )}

              {uniqueCategories.length > 0 && (
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500 transition-colors min-w-[160px]"
                >
                  <option value="">Все категории ({products.length})</option>
                  {uniqueCategories.map((id) => (
                    <option key={id} value={id}>
                      {id === "__EMPTY__"
                        ? `Без категории (${categoryCounts.get("__EMPTY__") || 0})`
                        : `${resolveName(id, lookups?.categories || [])} (${categoryCounts.get(id) || 0})`}
                    </option>
                  ))}
                </select>
              )}

              {uniqueSubcategories.length > 0 && (
                <select
                  value={filterSubcategory}
                  onChange={(e) => setFilterSubcategory(e.target.value)}
                  className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500 transition-colors min-w-[180px]"
                >
                  <option value="">Все подкатегории ({products.length})</option>
                  {uniqueSubcategories.map((id) => (
                    <option key={id} value={id}>
                      {id === "__EMPTY__"
                        ? `Без подкатегории (${subcategoryCounts.get("__EMPTY__") || 0})`
                        : `${resolveName(id, lookups?.subcategories || [])} (${subcategoryCounts.get(id) || 0})`}
                    </option>
                  ))}
                </select>
              )}

              {uniqueGenders.length > 0 && (
                <select
                  value={filterGender}
                  onChange={(e) => setFilterGender(e.target.value)}
                  className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500 transition-colors min-w-[140px]"
                >
                  <option value="">Все гендеры ({products.length})</option>
                  {uniqueGenders.map((g) => (
                    <option key={g} value={g}>
                      {g === "__EMPTY__" ? `Без гендера (${genderCounts.get("__EMPTY__") || 0})` : `${g} (${genderCounts.get(String(g)) || 0})`}
                    </option>
                  ))}
                </select>
              )}

              <select
                value={filterAiStatus}
                onChange={(e) => setFilterAiStatus(e.target.value as "" | "raw" | "ready" | "error")}
                className="min-w-[150px] rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-white outline-none transition-colors focus:border-indigo-500"
              >
                <option value="">Все по ИИ ({products.length})</option>
                <option value="raw">Сырой ({aiRemainingCount})</option>
                <option value="ready">ИИ готово ({aiReadyCount})</option>
                <option value="error">Ошибка ИИ ({aiErrorProducts.length})</option>
              </select>

              <select
                value={filterPrice}
                onChange={(e) => setFilterPrice(e.target.value)}
                className="min-w-[140px] rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-white outline-none transition-colors focus:border-indigo-500"
              >
                <option value="">Все цены ({products.length})</option>
                {uniquePrices.map((price) => (
                  <option key={price} value={String(price)}>
                    {price.toLocaleString("ru-RU")} ₽ ({priceCounts.get(String(price)) || 0})
                  </option>
                ))}
              </select>

              <select
                value={filterModel}
                onChange={(e) => setFilterModel(e.target.value)}
                className="min-w-[160px] rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-white outline-none transition-colors focus:border-indigo-500"
              >
                <option value="">Все модели ({products.length})</option>
                {uniqueModels.map((model) => (
                  <option key={model} value={model}>{model === "__EMPTY__" ? `Без модели (${modelCounts.get("__EMPTY__") || 0})` : `${model} (${modelCounts.get(model) || 0})`}</option>
                ))}
              </select>

              <select
                value={filterColor}
                onChange={(e) => setFilterColor(e.target.value)}
                className="min-w-[150px] rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-white outline-none transition-colors focus:border-indigo-500"
              >
                <option value="">Все цвета ({products.length})</option>
                {uniqueColors.map((color) => (
                  <option key={color} value={color}>{color === "__EMPTY__" ? `Без цвета (${colorCounts.get("__EMPTY__") || 0})` : `${color} (${colorCounts.get(color) || 0})`}</option>
                ))}
              </select>

              <select
                value={filterVariants}
                onChange={(e) => setFilterVariants(e.target.value as "" | "with" | "without")}
                className="min-w-[170px] rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-white outline-none transition-colors focus:border-indigo-500"
              >
                <option value="">Все варианты ({products.length})</option>
                <option value="with">Есть варианты ({productsWithVariantsCount})</option>
                <option value="without">Без вариантов ({products.length - productsWithVariantsCount})</option>
              </select>

              <select
                value={filterVideo}
                onChange={(e) => setFilterVideo(e.target.value as "" | "with" | "without")}
                className="min-w-[150px] rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-white outline-none transition-colors focus:border-indigo-500"
              >
                <option value="">Все видео ({products.length})</option>
                <option value="with">С видео ({productsWithVideoCount})</option>
                <option value="without">Без видео ({products.length - productsWithVideoCount})</option>
              </select>

              {(filterBrand ||
                filterCategory ||
                filterSubcategory ||
                filterGender ||
                filterAiStatus ||
                filterModel ||
                filterColor ||
                filterVariants ||
                filterVideo ||
                filterPrice !== "") && (
                  <button
                    onClick={() => {
                      setFilterBrand("");
                      setFilterCategory("");
                      setFilterSubcategory("");
                      setFilterGender("");
                      setFilterAiStatus("");
                      setFilterPrice("");
                      setFilterModel("");
                      setFilterColor("");
                      setFilterVariants("");
                      setFilterVideo("");
                    }}
                    className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-slate-700 transition-colors"
                  >
                    Сбросить
                  </button>
                )}

              {(filterBrand ||
                filterCategory ||
                filterSubcategory ||
                filterGender ||
                filterAiStatus ||
                filterModel ||
                filterColor ||
                filterVariants ||
                filterVideo ||
                filterPrice !== "") && (
                  <span className="text-xs text-slate-500 ml-auto">
                    Показано{" "}
                    <span className="text-white font-semibold">
                      {filteredProducts.length}
                    </span>{" "}
                    из {products.length}
                  </span>
                )}
            </div>
          )}

        {products.length === 0 && isBatchSource && (
          <div className="mx-auto mb-10 max-w-2xl rounded-2xl border border-slate-700 bg-slate-800 p-10 text-center shadow-xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900">
              <Database className="h-7 w-7 text-slate-500" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-white">
              {pathError ? "Не удалось загрузить товары" : "В партии нет товаров"}
            </h3>
            <p className="text-sm text-slate-400">
              {pathError || "В этой выгрузке пока нет товарных карточек."}
            </p>
          </div>
        )}

        {/* Grid */}
        {products.length > 0 && (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-500">
                Выбрано{" "}
                <span className="font-semibold text-slate-200">
                  {selectedForMerge.length}
                </span>{" "}
                из {filteredProducts.length} показанных
              </div>
              <div className="flex items-center gap-2">
                {viewMode === "cards" && (
                  <label className="hidden items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-400 xl:flex">
                    <span className="whitespace-nowrap">В ряд: {cardColumns}</span>
                    <input
                      type="range"
                      min="4"
                      max="10"
                      step="1"
                      value={cardColumns}
                      onChange={(event) => setCardColumns(Number(event.target.value))}
                      className="h-1.5 w-24 cursor-pointer accent-indigo-500"
                      aria-label="Количество карточек в ряду"
                    />
                  </label>
                )}
                <div className="flex items-center rounded-lg border border-slate-700 bg-slate-800 p-0.5">
                  <button
                    onClick={() => setViewMode("rows")}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      viewMode === "rows" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                    }`}
                    title="Компактные строки"
                  >
                    <Rows3 className="h-3.5 w-3.5" />
                    Строки
                  </button>
                  <button
                    onClick={() => setViewMode("cards")}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      viewMode === "cards" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                    }`}
                    title="Карточки товаров"
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Карточки
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowVariantFamilies(true)}
                  disabled={variantFamilyList.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-200 transition-colors hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Layers3 className="h-3.5 w-3.5" />
                  Семейные группы{variantFamilyList.length ? ` · ${variantFamilyList.length}` : ""}
                </button>
                <button
                  onClick={handleSelectFiltered}
                  disabled={filteredProducts.length === 0}
                  className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors"
                >
                  Выбрать все показанные
                </button>
                {selectedForMerge.length > 0 && (
                  <button
                    onClick={() => setSelectedForMerge([])}
                    className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                  >
                    Снять выбор
                  </button>
                )}
              </div>
            </div>
            <div
              className={viewMode === "cards"
                ? "grid gap-5 pb-48"
                : "mb-48 overflow-x-auto rounded-xl border border-slate-700 bg-slate-900"
              }
              style={viewMode === "cards" ? { gridTemplateColumns: `repeat(${cardColumns}, minmax(0, 1fr))` } : undefined}
            >
              {viewMode === "rows" && (
                <div className="grid min-w-[1160px] grid-cols-[minmax(400px,2.4fr)_64px_64px_70px_minmax(150px,0.8fr)_minmax(190px,1fr)_136px_42px] items-center gap-3 border-b border-slate-700 bg-slate-950/80 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <div>Китайский исходный текст</div>
                  <div>№</div>
                  <div>Фото</div>
                  <div>Кол-во</div>
                  <div>External ID</div>
                  <div>Классификация</div>
                  <div>Статус</div>
                  <div />
                </div>
              )}
              {displayedProducts.map((product, displayedIndex) => {
                const realIndex = products.indexOf(product);
                const selectionOrder = selectedForMerge.indexOf(realIndex);
                const adminProduct = {
                  id: String(product.id || product.external_id || realIndex),
                  productId: product.external_id || String(product.id || realIndex),
                  name: product.name,
                  description: product.description,
                  price: Number(product.price || 0),
                  status: product.status,
                  brand: product.brand ? [product.brand] : [],
                  category: product.category,
                  subcategory: product.subcategory,
                  gender: product.gender || '',
                  photos: product.photos || [],
                  attributes: product.attributes || {},
                  metadata: {},
                  created: '', updated: '', collectionId: '', collectionName: 'products',
                } as any;
                const variants = variantGroups.get(approvedVariantGroupKey(product)) || [];
                const variantColors = [...new Set(variants.flatMap((variant) => attributeValues(variant.attributes?.colors ?? variant.attributes?.color)))];
                return <React.Fragment key={`${product.external_id}-${realIndex}`}>
                  {sampleProducts.length > 0 && displayedIndex === 0 && (
                    <div className={`${viewMode === "rows" ? "min-w-[1120px] rounded-none border-x-0" : "col-span-full rounded-xl"} flex items-center justify-between border border-indigo-500/30 bg-indigo-500/10 px-4 py-3`}>
                      <div><div className="font-semibold text-indigo-200">Тест ИИ</div><div className="text-xs text-slate-400">Первые для проверки · {sampleProducts.length} товаров</div></div>
                    </div>
                  )}
                  {sampleProducts.length > 0 && displayedIndex === sampleProducts.length && (
                    <div className={`${viewMode === "rows" ? "min-w-[1120px] px-4 py-3" : "col-span-full mt-2 pt-4"} border-t border-slate-700 text-sm font-semibold text-slate-300`}>Остальные товары · {filteredProducts.length - sampleProducts.length}</div>
                  )}
                {viewMode === "rows" ? (
                  <CsvProductRow
                    product={product}
                    index={realIndex}
                    lookups={lookups}
                    isSelected={selectionOrder !== -1}
                    selectionOrder={selectionOrder + 1}
                    onToggleSelection={(event) => toggleMergeSelection(realIndex, Boolean(event?.shiftKey))}
                    onRemove={handleRemove}
                    onClick={() => setSelectedIdx(realIndex)}
                  />
                ) : isBatchSource ? (
                  <AdminProductCard
                    product={adminProduct}
                    showAttributeSummary={false}
                    onEdit={() => setSelectedIdx(realIndex)}
                    onDelete={() => handleRemove(realIndex)}
                    onUpdate={() => undefined}
                    selected={selectionOrder !== -1}
                    onToggleSelect={() => toggleMergeSelection(realIndex)}
                    onSelectionClick={(event) => toggleMergeSelection(realIndex, event.shiftKey)}
                    brands={(lookups?.brands || []) as any}
                    categories={(lookups?.categories || []) as any}
                    subcategories={(lookups?.subcategories || []) as any}
                    allowDuplicate={false}
                    variantCount={variants.length}
                    variantColors={variantColors}
                    onInlineUpdate={async (_current, patch) => {
                      if (patch.name !== undefined) updateProduct(realIndex, 'name', String(patch.name));
                      if (patch.price !== undefined) updateProduct(realIndex, 'price', Number(patch.price));
                    }}
                  />
                ) : (
                  <CsvProductCard
                    product={product}
                    index={realIndex}
                    lookups={lookups}
                    isSelected={selectionOrder !== -1}
                    selectionOrder={selectionOrder + 1}
                    onToggleSelection={(event) => toggleMergeSelection(realIndex, Boolean(event?.shiftKey))}
                    onRemove={handleRemove}
                    onUpdate={updateProduct}
                    onClick={() => setSelectedIdx(realIndex)}
                    localPath={localPath}
                  />
                )}
                </React.Fragment>;
              })}
            </div>
          </>
        )}

        {/* Floating Bulk Action Bar */}
        {selectedForMerge.length > 0 && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="bg-slate-800/95 backdrop-blur-md border border-slate-700 shadow-2xl rounded-2xl px-5 py-4 flex max-w-[calc(100vw-2rem)] flex-col gap-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-3 pr-4 border-r border-slate-700">
                <div className="p-2 bg-indigo-500/20 rounded-lg">
                  <CheckSquare className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white">
                    Выбрано {selectedForMerge.length}
                  </div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest font-medium">
                    Товаров для массовых действий
                  </div>
                </div>
              </div>

                <div className="grid min-w-[min(920px,calc(100vw-3rem))] flex-1 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <label className="relative">
                    <span className="sr-only">Цена для выбранных</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={bulkPrice}
                      onChange={(event) => setBulkPrice(event.target.value)}
                      placeholder="Цена для выбранных, ₽"
                      className="h-full min-h-10 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-indigo-500"
                    />
                  </label>
                  <SearchableLookupSelect
                    value={bulkBrand}
                    onChange={setBulkBrand}
                    items={lookups?.brands || []}
                    placeholder="Бренд для выбранных"
                  />
                  <SearchableLookupSelect
                    value={bulkCategory}
                    onChange={(nextCategory) => {
                      setBulkCategory(nextCategory);
                      const subcategoryExists = (lookups?.subcategories || []).some(
                        (subcategory) =>
                          subcategory.id === bulkSubcategory &&
                          subcategory.category === nextCategory,
                      );
                      if (!subcategoryExists) setBulkSubcategory("");
                    }}
                    items={lookups?.categories || []}
                    placeholder="Категория для выбранных"
                  />
                  <SearchableLookupSelect
                    value={bulkSubcategory}
                    onChange={setBulkSubcategory}
                    disabled={!bulkCategory}
                    items={(lookups?.subcategories || [])
                      .filter((subcategory) => subcategory.category === bulkCategory)
                      .map((subcategory) => ({
                        id: subcategory.id,
                        name: subcategory.name,
                      }))}
                    placeholder="Подкатегория для выбранных"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  onClick={() => setSelectedForMerge([])}
                  className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
                >
                  Отмена
                </button>
                <button
                  onClick={async () => {
                    const ids = selectedForMerge
                      .map((index) => Number(products[index]?.id))
                      .filter(Number.isInteger);
                    if (!ids.length) return;
                    setSelectedForMerge([]);
                    await handleAiProcess("selection", ids);
                  }}
                  disabled={isProcessing || !batchId}
                  className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-violet-500/20 transition-all hover:bg-violet-500 disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {selectedForMerge.every((index) => (
                    products[index]?.ai_processed === true || products[index]?.ai_processed === "true"
                  )) ? "Переобработать выбранные" : "Обработать с ИИ"}
                </button>
                <button
                  onClick={handleBulkApply}
                  disabled={bulkPrice === "" && !bulkBrand && !bulkCategory && !bulkSubcategory}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50 disabled:grayscale"
                >
                  Применить цену и поля
                </button>
                <button
                  type="button"
                  onClick={() => setShowBulkVariantFamily(true)}
                  disabled={!batchId || isSnapshotSource}
                  className="inline-flex items-center gap-2 rounded-xl border border-violet-500/40 bg-violet-500/10 px-5 py-2.5 text-sm font-bold text-violet-100 transition-all hover:bg-violet-500/20 disabled:opacity-50"
                >
                  <Layers3 className="h-4 w-4" />
                  В семейную группу
                </button>
                <button
                  onClick={handleMergePhotos}
                  disabled={selectedForMerge.length < 2}
                  className="px-6 py-2.5 bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-400 hover:to-blue-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2 disabled:opacity-50 disabled:grayscale"
                >
                  <Merge className="w-4 h-4" />
                  Объединить фото
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <VariantFamiliesDialog
        open={showVariantFamilies}
        families={variantFamilyList}
        onClose={() => setShowVariantFamilies(false)}
        onDeleteFamily={async (family) => {
          if (!batchId || isSnapshotSource) return;
          if (!window.confirm(`Удалить семью «${family.title}» вместе со всеми товарами (${family.products.length})?`)) return;
          const result = await deleteBatchVariantFamilyAction(batchId, family.key);
          if (!result.success) {
            setSaveMsg(`✗ Ошибка БД: ${result.error || "не удалось удалить семью"}`);
            return;
          }
          const familyIds = new Set(family.products.map((product) => Number(product.id)));
          setProducts((current) => current.filter((product) => !familyIds.has(Number(product.id))));
          setSelectedForMerge((current) => current.filter((index) => !familyIds.has(Number(products[index]?.id))));
          setSaveMsg(`✓ Семья удалена: ${result.data?.deletedCount || family.products.length} товаров`);
        }}
        onOpenProduct={(product) => {
          const nextIndex = products.indexOf(product);
          if (nextIndex >= 0) setSelectedIdx(nextIndex);
        }}
      />

      {batchId && (
        <BulkVariantFamilyDialog
          open={showBulkVariantFamily}
          batchId={batchId}
          selectedProductIds={selectedForMerge
            .map((index) => Number(products[index]?.id))
            .filter(Number.isInteger)}
          families={variantFamilyList}
          onClose={() => setShowBulkVariantFamily(false)}
          onChanged={(productIds, groupKey, groupName) => {
            const changedIds = new Set(productIds);
            setProducts((current) => current.map((product) => (
              changedIds.has(Number(product.id)) ? { ...product, variant_group_key: groupKey, variant_group_name: groupName } : product
            )));
            setSelectedForMerge([]);
            setSaveMsg("Цветовая семья сохранена");
          }}
        />
      )}

      {/* Drawer */}
      <CsvProductDrawer
        product={selectedIdx !== null ? products[selectedIdx] : null}
        index={selectedIdx ?? -1}
        lookups={lookups}
        isOpen={selectedIdx !== null}
        onClose={() => setSelectedIdx(null)}
        onUpdate={updateProduct}
        onRetryAi={batchId && selectedIdx !== null ? () => handleRetryProductAi(products[selectedIdx]) : undefined}
        onSplitColors={batchId && selectedIdx !== null && products[selectedIdx].photos.length >= 2
          ? () => handleSplitProductColors(products[selectedIdx])
          : undefined}
        onRollbackAi={batchId && selectedIdx !== null && (products[selectedIdx].ai_processed === true || products[selectedIdx].ai_processed === "true")
          ? () => handleRollbackProductAi(products[selectedIdx])
          : undefined}
        aiBusy={isProcessing}
        allProducts={products}
        batchId={batchId}
        variants={selectedIdx !== null ? variantGroups.get(approvedVariantGroupKey(products[selectedIdx])) || [] : []}
        onVariantsChanged={(productIds, groupKey, groupName) => {
          const changedIds = new Set(productIds);
          setProducts((current) => current.map((item) => changedIds.has(Number(item.id)) ? { ...item, variant_group_key: groupKey, variant_group_name: groupName || null } : item));
        }}
        onOpenVariant={(variant) => {
          const nextIndex = products.indexOf(variant);
          if (nextIndex >= 0) setSelectedIdx(nextIndex);
        }}
        supplierName={initialSupplierName || undefined}
      />
      {showAiSuggestions && batchId && (
        <BatchAiReviewDialog
          batchId={batchId}
          batchName={initialSupplierName || fileName}
          onReviewed={() => loadAiSuggestions(batchId)}
          onClose={() => {
            setShowAiSuggestions(false);
            loadAiSuggestions(batchId);
          }}
        />
      )}
    </div>
  );
}

// ─── Compact source row ────────────────────────────────────────────────

function photoCountStyle(count: number) {
  if (count === 4) return "border-cyan-500/30 bg-cyan-500/10 text-cyan-300";
  if ([8, 9, 11].includes(count)) return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-slate-600 bg-slate-800 text-slate-300";
}

function CsvProductRow({
  product,
  index,
  lookups,
  isSelected,
  selectionOrder,
  onToggleSelection,
  onRemove,
  onClick,
}: {
  product: CsvProduct;
  index: number;
  lookups: Lookups | null;
  isSelected: boolean;
  selectionOrder: number;
  onToggleSelection: (event?: React.MouseEvent) => void;
  onRemove: (index: number) => void;
  onClick: () => void;
}) {
  const photoCount = product.photos?.length || 0;
  const sourceNumber = (product.source_position ?? index) + 1;
  const description = String(product.description || "").replace(/\\n/g, " · ");
  const brandName = lookups ? resolveName(product.brand, lookups.brands) : product.brand;
  const categoryName = lookups ? resolveName(product.category, lookups.categories) : product.category;
  const subcategoryName = lookups ? resolveName(product.subcategory, lookups.subcategories) : product.subcategory;
  const chromoffCategory = chromoffCategoryForDisplay(product);
  const video = productVideoForDisplay(product);

  return (
    <div
      className={`grid min-h-[68px] min-w-[1160px] cursor-pointer grid-cols-[minmax(400px,2.4fr)_64px_64px_70px_minmax(150px,0.8fr)_minmax(190px,1fr)_136px_42px] items-center gap-3 border-b border-slate-800 px-3 py-2 transition-colors last:border-b-0 ${
        isSelected ? "bg-indigo-500/10 hover:bg-indigo-500/15" : "hover:bg-slate-800/70"
      }`}
      onClick={onClick}
    >
      <div className="min-w-0">
        <p
          className="line-clamp-2 font-mono text-[12px] leading-5 text-slate-200"
          title={description}
        >
          {description || "Без исходного текста"}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelection(event);
          }}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold ${
            isSelected
              ? "border-indigo-400 bg-indigo-500 text-white"
              : "border-slate-600 bg-slate-800 text-slate-500 hover:border-slate-400"
          }`}
          title={isSelected ? `Выбран ${selectionOrder}-м` : "Выбрать товар"}
        >
          {isSelected ? selectionOrder : ""}
        </button>
        <span className="font-mono text-[11px] text-slate-500">#{sourceNumber}</span>
      </div>

      <div className="relative h-12 w-12 overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
        {product.photos?.[0] ? (
          <Image
            src={resizeImageUrl(product.photos[0], imagePresets.productTable)}
            alt=""
            fill
            sizes="48px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[9px] uppercase text-slate-600">Нет</div>
        )}
        {video.url && <span className="absolute -right-1 -top-1 rounded bg-cyan-700 px-1 text-[8px] font-bold text-white">▶</span>}
      </div>

      <div>
        <span className={`inline-flex min-w-9 justify-center rounded-md border px-2 py-1 text-xs font-bold ${photoCountStyle(photoCount)}`}>
          {photoCount}
        </span>
      </div>

      <div className="min-w-0">
        <p className="truncate font-mono text-[11px] text-slate-400" title={product.external_id}>
          {product.external_id || "Без ID"}
        </p>
      </div>

      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-slate-200" title={[brandName, categoryName, subcategoryName].filter(Boolean).join(" · ")}>
          {[brandName, categoryName].filter(Boolean).join(" · ") || "Не определено"}
        </p>
        <p className="truncate text-[10px] text-slate-500">{subcategoryName || "Без подкатегории"}</p>
        {chromoffCategory && (
          <p className={chromoffCategory.status === "ai_assigned" ? "truncate text-[10px] text-violet-300" : "truncate text-[10px] text-amber-300"}>
            Chromoff: {chromoffCategory.name}{chromoffCategory.status === "needs_review" ? " · проверить" : ""}
          </p>
        )}
      </div>

      <div className="flex items-center">
        <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-semibold ${
          product.ai_processed === true || product.ai_processed === "true"
            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
            : "border-cyan-500/25 bg-cyan-500/10 text-cyan-300"
        }`}>
          {product.ai_processed === true || product.ai_processed === "true" ? "ИИ готово" : "Сырой"}
        </span>
      </div>

      <button
        onClick={(event) => {
          event.stopPropagation();
          if (confirm(`Удалить товар #${sourceNumber}?`)) onRemove(index);
        }}
        className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-red-500/10 hover:text-red-300"
        title="Удалить товар"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────

interface CsvProductCardProps {
  product: CsvProduct;
  index: number;
  lookups: Lookups | null;
  isSelected: boolean;
  selectionOrder: number;
  onToggleSelection: (event?: React.MouseEvent) => void;
  onRemove: (i: number) => void;
  onUpdate: (i: number, f: keyof CsvProduct, v: any) => void;
  onClick: () => void;
  localPath?: string;
  onRetryAi?: () => void;
}

function CsvProductCard({
  product,
  index,
  lookups,
  isSelected,
  selectionOrder,
  onToggleSelection,
  onRemove,
  onUpdate,
  onClick,
  onRetryAi,
}: CsvProductCardProps) {
  const [editField, setEditField] = useState<"name" | "price" | null>(null);
  const [editVal, setEditVal] = useState("");
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (product.external_id) {
      navigator.clipboard.writeText(product.external_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const brandName = lookups
    ? resolveName(product.brand, lookups.brands)
    : product.brand;
  const categoryName = lookups
    ? resolveName(product.category, lookups.categories)
    : product.category;
  const subcategoryName = lookups
    ? resolveName(product.subcategory, lookups.subcategories)
    : product.subcategory;
  const chromoffCategory = chromoffCategoryForDisplay(product);
  const video = productVideoForDisplay(product);

  const startEdit = (field: "name" | "price", e: React.MouseEvent) => {
    e.stopPropagation();
    setEditField(field);
    setEditVal(field === "price" ? product.price.toString() : product.name);
  };

  const save = () => {
    if (editField === "price")
      onUpdate(index, "price", parseFloat(editVal) || 0);
    else if (editField) onUpdate(index, editField, editVal.trim());
    setEditField(null);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") save();
    else if (e.key === "Escape") setEditField(null);
  };

  return (
    <div
      className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden hover:shadow-xl hover:shadow-black/20 hover:border-slate-600 transition-all duration-300 group flex flex-col cursor-pointer"
      onClick={onClick}
    >
      <div
        className={`relative aspect-square overflow-hidden bg-slate-900 transition-all ${isSelected ? "ring-4 ring-indigo-500 ring-inset" : ""}`}
      >
        {product.photos?.[0] ? (
          <Image
            src={resizeImageUrl(product.photos[0], imagePresets.productGrid)}
            alt={product.name || ""}
            fill
            sizes="(max-width:768px) 100vw,25vw"
            className={`object-cover transition-transform duration-500 ${isSelected ? "scale-105 opacity-100" : "group-hover:scale-105 opacity-90 group-hover:opacity-100"}`}
            unoptimized
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-600 text-xs uppercase tracking-widest">
            No image
          </div>
        )}

        {/* Selection Overlay */}
        <div
          className={`absolute inset-0 transition-colors ${isSelected ? "bg-indigo-500/10" : "hover:bg-black/20"}`}
        />

        {/* Checkbox */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelection(e);
          }}
          className={`absolute top-3 left-3 w-8 h-8 rounded-full flex items-center justify-center transition-all z-10 shadow-lg ${isSelected ? "bg-indigo-500 text-white scale-110" : "bg-slate-900/60 text-slate-400 opacity-0 group-hover:opacity-100"}`}
        >
          {isSelected ? (
            <span className="text-xs font-bold">{selectionOrder}</span>
          ) : (
            <Square className="w-4 h-4" />
          )}
        </button>

        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(index);
            }}
            className="p-2 bg-slate-900/80 backdrop-blur-sm rounded-full shadow-lg hover:bg-red-600 text-slate-300 hover:text-white transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <span className="absolute bottom-3 left-3 px-2 py-1 text-xs font-mono bg-slate-900/80 backdrop-blur-sm rounded-md text-slate-300 z-10">
          #{index + 1}
        </span>
        {video.url && <span className="absolute top-3 left-3 rounded-md border border-cyan-300/30 bg-cyan-950/80 px-2 py-1 text-[10px] font-semibold text-cyan-200 z-10">Видео</span>}

        {/* Photo Count Tag & Quick Actions */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 z-10">
          {product.photos && product.photos.length > 0 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate(index, "photos", product.photos.slice(1));
                }}
                title="Удалить первое фото"
                className="px-2 py-1 bg-red-500/80 hover:bg-red-600 backdrop-blur-sm rounded text-[10px] font-bold text-white transition-colors border border-red-400/20"
              >
                Удалить 1-е
              </button>
              <div className="px-2 py-1 bg-slate-900/80 backdrop-blur-sm rounded-md text-[10px] font-bold text-slate-300 border border-slate-700/50">
                {product.photos.length} фото
              </div>
            </>
          )}
        </div>
      </div>

      <div className="p-5 flex-1 flex flex-col">
        {product.ai_error && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300" title={product.ai_error}>
            {product.ai_error}
          </div>
        )}
        {onRetryAi && (
          <button onClick={(event) => { event.stopPropagation(); onRetryAi(); }} className="mb-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/20">
            {product.ai_processed || product.ai_error ? "Повторить ИИ" : "Обработать ИИ"}
          </button>
        )}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1 min-w-0 group/id">
            <div className="text-[10px] text-slate-500 font-mono truncate" title={product.external_id}>
              {product.external_id || "—"}
            </div>

            <button
               onClick={handleCopy}
               className={`p-1 rounded-md transition-all flex-shrink-0 ${copied ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-600 hover:text-indigo-400 hover:bg-slate-700 opacity-0 group-hover/id:opacity-100'}`}
               title="Копировать ID"
            >
               {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        </div>
        <div className="mb-2 text-xs text-slate-500 truncate">
          {brandName && <span className="text-indigo-400">{brandName}</span>}
          {categoryName && <span> • {categoryName}</span>}
          {subcategoryName && <span> • {subcategoryName}</span>}
        </div>
        {chromoffCategory && (
          <div className={`mb-3 inline-flex max-w-full self-start rounded-full border px-2 py-1 text-[10px] font-semibold ${chromoffCategory.status === "ai_assigned" ? "border-violet-500/30 bg-violet-500/10 text-violet-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}`}>
            Chromoff: {chromoffCategory.name}{chromoffCategory.status === "needs_review" ? " · проверить" : ""}
          </div>
        )}

        {editField === "name" ? (
          <input
            type="text"
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={save}
            onKeyDown={onKey}
            autoFocus
            className="text-base font-bold text-slate-100 mb-2 bg-slate-700 border border-indigo-500 rounded px-2 py-1 w-full outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <h3
            className="text-base font-bold text-slate-100 mb-2 leading-tight cursor-text hover:bg-slate-700/50 rounded px-1 -mx-1"
            onClick={(e) => startEdit("name", e)}
          >
            {product.name || "Без имени"}
          </h3>
        )}

        {product.description && (
          <p className="text-sm text-slate-400 mb-4 line-clamp-2 flex-1">
            {product.description}
          </p>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-slate-700 mt-auto">
          {editField === "price" ? (
            <input
              type="number"
              value={editVal}
              onChange={(e) => setEditVal(e.target.value)}
              onBlur={save}
              onKeyDown={onKey}
              autoFocus
              className="font-bold text-lg text-slate-200 bg-slate-700 border border-indigo-500 rounded px-2 py-1 w-24 outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div
              className="font-bold text-lg text-slate-200 cursor-text hover:bg-slate-700/50 rounded px-1 -mx-1"
              onClick={(e) => startEdit("price", e)}
            >
              {product.price > 0
                ? new Intl.NumberFormat("ru-RU", {
                  style: "currency",
                  currency: "RUB",
                  maximumFractionDigits: 0,
                }).format(product.price)
                : "—"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Drawer ────────────────────────────────────────────────────────────

interface CsvProductDrawerProps {
  product: CsvProduct | null;
  index: number;
  lookups: Lookups | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (i: number, f: keyof CsvProduct, v: any) => void;
  onRetryAi?: () => void;
  onSplitColors?: () => void;
  onRollbackAi?: () => void;
  aiBusy?: boolean;
  allProducts: CsvProduct[];
  batchId?: string | null;
  variants: CsvProduct[];
  onVariantsChanged: (productIds: number[], groupKey: string | null, groupName?: string) => void;
  onOpenVariant: (product: CsvProduct) => void;
  supplierName?: string;
}

function CsvProductDrawer({
  product,
  index,
  lookups,
  isOpen,
  onClose,
  onUpdate,
  onRetryAi,
  onSplitColors,
  onRollbackAi,
  aiBusy = false,
  allProducts,
  batchId,
  variants,
  onVariantsChanged,
  onOpenVariant,
  supplierName,
}: CsvProductDrawerProps) {
  const [local, setLocal] = useState<CsvProduct | null>(null);

  useEffect(() => {
    setLocal(product ? { ...product } : null);
  }, [product, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isOpen]);

  if (!isOpen || !local) return null;

  const change = (field: keyof CsvProduct, value: any) => {
    setLocal((prev) => (prev ? { ...prev, [field]: value } : null));
    onUpdate(index, field, value);
  };

  const attributes = local.attributes || {};
  const video = productVideoForDisplay(local);
  const categoryName = (lookups?.categories || []).find((category) => category.id === local.category)?.name || local.category;
  const isClothing = String(categoryName).trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е") === "одежда";
  const isShoe = String(categoryName).trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е") === "обувь";
  const updateAttribute = (oldKey: string, nextKey: string, nextValue: string) => {
    const next = { ...attributes };
    if (oldKey !== nextKey) delete next[oldKey];
    if (nextKey.trim()) {
      let parsed: unknown = nextValue;
      if (Array.isArray(attributes[oldKey])) {
        parsed = nextValue.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
      } else {
        try {
          parsed = JSON.parse(nextValue);
        } catch {
          parsed = nextValue;
        }
      }
      next[nextKey.trim()] = parsed as any;
    }
    change("attributes", next);
  };

  const removeAttribute = (key: string) => {
    const next = { ...attributes };
    delete next[key];
    change("attributes", next);
  };

  const updateMeasurements = (value: unknown) => {
    const next = { ...attributes };
    if (value === undefined || value === null || value === "") delete next.measurements;
    else next.measurements = value as any;
    change("attributes", next);
  };

  const updateManualVideo = (key: "manual_video_url" | "manual_video_poster_url", value: string) => {
    const next = { ...attributes };
    const trimmed = value.trim();
    if (trimmed) next[key] = trimmed;
    else delete next[key];
    if (key === "manual_video_url") {
      delete next.hosted_video_url;
      delete next.hosted_video_poster_url;
    }
    change("attributes", next);
  };

  const removePhoto = (i: number) => {
    const photos = local.photos.filter((_, j) => j !== i);
    const currentPhotoAlts = Array.from(
      { length: local.photos.length },
      (_, photoIndex) => local.photo_alts?.[photoIndex] || local.name || "",
    );
    const photoAlts = currentPhotoAlts.filter((_, j) => j !== i);
    const photoSlugs = Array.from(
      { length: local.photos.length },
      (_, photoIndex) => local.photo_slugs?.[photoIndex] || `foto-${photoIndex + 1}`,
    ).filter((_, j) => j !== i);
    setLocal((prev) => prev ? { ...prev, photos, photo_alts: photoAlts, photo_slugs: photoSlugs } : null);
    onUpdate(index, "photos", photos);
    onUpdate(index, "photo_alts", photoAlts);
    onUpdate(index, "photo_slugs", photoSlugs);
  };

  const movePhoto = (fromIndex: number, toIndex: number) => {
    const photos = [...local.photos];
    const [photo] = photos.splice(fromIndex, 1);
    photos.splice(toIndex, 0, photo);
    const photoAlts = Array.from(
      { length: local.photos.length },
      (_, photoIndex) => local.photo_alts?.[photoIndex] || local.name || "",
    );
    const [photoAlt] = photoAlts.splice(fromIndex, 1);
    photoAlts.splice(toIndex, 0, photoAlt);
    const photoSlugs = Array.from(
      { length: local.photos.length },
      (_, photoIndex) => local.photo_slugs?.[photoIndex] || `foto-${photoIndex + 1}`,
    );
    const [photoSlug] = photoSlugs.splice(fromIndex, 1);
    photoSlugs.splice(toIndex, 0, photoSlug);
    setLocal((prev) => prev ? { ...prev, photos, photo_alts: photoAlts, photo_slugs: photoSlugs } : null);
    onUpdate(index, "photos", photos);
    onUpdate(index, "photo_alts", photoAlts);
    onUpdate(index, "photo_slugs", photoSlugs);
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl overflow-y-auto overscroll-contain border-l border-slate-700 bg-slate-900 shadow-2xl">
        <div className="h-full flex flex-col">
          <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between bg-slate-800 sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/10 rounded-lg">
                <Edit3 className="w-5 h-5 text-indigo-400" />
              </div>
              <h2 className="text-lg font-semibold text-white">
                Редактирование #{index + 1}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {onRollbackAi && (
                <button
                  onClick={onRollbackAi}
                  disabled={aiBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Откатить ИИ
                </button>
              )}
              {onRetryAi && (
                <button onClick={onRetryAi} disabled={aiBusy} className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50">
                  {local.ai_processed || local.ai_error ? "Повторить ИИ" : "Обработать ИИ"}
                </button>
              )}
              <button
                onClick={onClose}
                className="p-2 text-slate-400 hover:text-white rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="flex-1 p-6 space-y-8 pb-32">
            {/* Photos */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Фотографии ({local.photos.length})
                </h3>
                {local.photos.length > 0 && (
                  <button
                    onClick={() => removePhoto(0)}
                    className="text-[10px] font-bold text-red-400 hover:text-red-300 transition-colors uppercase tracking-wider"
                  >
                    Удалить первое фото
                  </button>
                )}
              </div>
              <ProductPhotoGallery
                photos={local.photos}
                altTexts={local.photo_alts}
                onMove={movePhoto}
                onRemove={removePhoto}
              />
            </section>

            <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Видео товара</h3>
                  {video.url && <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-300">
                    {video.url === String(attributes.manual_video_url || '').trim() ? 'Вручную' : video.url === String(attributes.hosted_video_url || '').trim() ? 'S3' : 'Источник'}
                  </span>}
                </div>
                {video.url && <video
                  className="max-h-[420px] w-full rounded-xl border border-slate-700 bg-black object-contain"
                  src={video.url}
                  poster={video.posterUrl || undefined}
                  controls
                  playsInline
                  preload="metadata"
                />}
                <input
                  type="url"
                  value={String(attributes.manual_video_url || "")}
                  onChange={(event) => updateManualVideo("manual_video_url", event.target.value)}
                  placeholder="Вставить или заменить ссылку на видео"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-500"
                />
                <input
                  type="url"
                  value={String(attributes.manual_video_poster_url || "")}
                  onChange={(event) => updateManualVideo("manual_video_poster_url", event.target.value)}
                  placeholder="Ссылка на постер видео (необязательно)"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-500"
                />
                {video.url && <p className="break-all text-[10px] text-slate-600">{video.url}</p>}
              </section>

            <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Palette className="h-4 w-4 text-violet-300" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">{local.variant_group_name || "Цветовые варианты"} ({variants.length > 1 ? variants.length : 0})</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    {onSplitColors && (
                      <button
                        type="button"
                        onClick={onSplitColors}
                        disabled={aiBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-300 hover:bg-violet-500/20 disabled:opacity-50"
                        title="Один AI-запрос: разделить фото, создать товары и объединить их в семью"
                      >
                        <Palette className="h-3.5 w-3.5" />
                        Разделить по цветам
                      </button>
                    )}
                    {batchId && local.id != null && (
                      <VariantFamilyManager
                        product={local}
                        products={allProducts}
                        batchId={batchId}
                        onChanged={onVariantsChanged}
                      />
                    )}
                  </div>
                </div>
                {variants.length > 1 ? <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
                  {variants.map((variant) => {
                    const active = String(variant.id || variant.external_id) === String(local.id || local.external_id);
                    const colors = attributeValuesForDisplay(variant.attributes?.colors ?? variant.attributes?.color);
                    return (
                      <button
                        type="button"
                        key={String(variant.id || variant.external_id)}
                        onClick={() => onOpenVariant(variant)}
                        className={`min-w-0 overflow-hidden rounded-lg border text-left transition ${active ? "border-violet-400 bg-violet-500/10 ring-1 ring-violet-400/30" : "border-slate-700 bg-slate-800 hover:border-slate-500"}`}
                      >
                        <div className="relative aspect-square bg-slate-950">
                          {variant.photos?.[0] ? <Image src={resizeImageUrl(variant.photos[0], imagePresets.productGrid)} alt={colors.join(", ")} fill className="object-cover" unoptimized /> : <div className="flex h-full items-center justify-center text-xs text-slate-600">Нет фото</div>}
                        </div>
                        <div className="px-2 py-1.5"><div className="truncate text-[11px] font-semibold leading-tight text-white" title={colors.join(", ")}>{colors.join(", ") || "Цвет не указан"}</div>{active && <div className="mt-0.5 truncate text-[9px] font-medium leading-tight text-violet-300">Открыт</div>}</div>
                      </button>
                    );
                  })}
                </div> : (
                  <div className="rounded-lg border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-500">
                    Товар пока не привязан к цветовой семье
                  </div>
                )}
              </section>

            {/* Fields */}
            <section className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Название</label>
                <input
                  type="text"
                  value={local.name}
                  onChange={(e) => change("name", e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-indigo-500 outline-none"
                />
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-slate-500">Цена</label>
                  <input
                    type="number"
                    value={local.price}
                    onChange={(e) =>
                      change("price", parseFloat(e.target.value) || 0)
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Описание</label>
                <textarea
                  rows={5}
                  value={local.description}
                  onChange={(e) => change("description", e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-indigo-500 outline-none text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">H1</label>
                <input value={local.h1 || ""} onChange={(e) => change("h1", e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-indigo-500 outline-none" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">SEO title</label>
                <input value={local.seo_title || ""} onChange={(e) => change("seo_title", e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-indigo-500 outline-none" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">SEO description</label>
                <textarea rows={3} value={local.seo_description || ""} onChange={(e) => change("seo_description", e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-indigo-500 outline-none text-sm" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-800">
                <div className="space-y-1">
                  <label className="text-xs text-slate-500">
                    Бренд
                  </label>
                  <SearchableLookupSelect
                    value={local.brand}
                    onChange={(nextBrand) => change("brand", nextBrand)}
                    items={lookups?.brands || []}
                    placeholder="Найти бренд..."
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-500">
                    Категория
                  </label>
                  <SearchableLookupSelect
                    value={local.category}
                    onChange={(nextCategory) => {
                      const subcategoryExists = (lookups?.subcategories || []).some(
                        (subcategory) =>
                          subcategory.id === local.subcategory &&
                          subcategory.category === nextCategory,
                      );
                      change("category", nextCategory);
                      if (!subcategoryExists) change("subcategory", "");
                    }}
                    items={lookups?.categories || []}
                    placeholder="Найти категорию..."
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-500">
                    Гендер
                  </label>
                  <select
                    value={local.gender || ""}
                    onChange={(event) => change("gender", event.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-indigo-500"
                  >
                    <option value="">Не указан</option>
                    {local.gender && !["male", "female", "unisex"].includes(local.gender) && (
                      <option value={local.gender}>{local.gender}</option>
                    )}
                    <option value="male">Для мужчин</option>
                    <option value="female">Для женщин</option>
                    <option value="unisex">Унисекс</option>
                  </select>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs text-slate-500">
                    Подкатегория
                  </label>
                  <SearchableLookupSelect
                    value={local.subcategory}
                    onChange={(nextSubcategory) => change("subcategory", nextSubcategory)}
                    disabled={!local.category}
                    items={(lookups?.subcategories || [])
                      .filter((subcategory) => subcategory.category === local.category)
                      .map((subcategory) => ({
                        id: subcategory.id,
                        name: subcategory.name,
                      }))}
                    placeholder="Найти подкатегорию..."
                  />
                </div>
              </div>
              <div className="space-y-3 border-t border-slate-800 pt-4">
                {(isClothing || isShoe) && <MeasurementsField
                  value={attributes.measurements}
                  onChange={updateMeasurements}
                  shoe={isShoe}
                />}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs text-slate-500">Дополнительные атрибуты</label>
                    <p className="mt-1 text-[11px] text-slate-600">Ключи сохраняются в JSON и не меняют старый CSV-контракт.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => change("attributes", { ...attributes, "": "" })}
                    className="rounded-lg border border-indigo-500/30 px-3 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/10"
                  >
                    Добавить
                  </button>
                </div>
                {Object.entries(attributes).filter(([key]) => key !== "measurements").length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-700 p-3 text-xs text-slate-600">
                    Других атрибутов пока нет
                  </div>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(attributes).filter(([key]) => key !== "measurements").map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2">
                        <input
                          value={key}
                          onChange={(event) => updateAttribute(key, event.target.value, String(value ?? ""))}
                          placeholder="Ключ"
                          className="w-1/3 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                        />
                        <input
                          value={Array.isArray(value) ? value.join(", ") : String(value ?? "")}
                          onChange={(event) => updateAttribute(key, key, event.target.value)}
                          placeholder="Значение"
                          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                        />
                        <button
                          type="button"
                          onClick={() => removeAttribute(key)}
                          className="rounded-lg p-2 text-slate-500 hover:bg-red-500/10 hover:text-red-300"
                          title="Удалить атрибут"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="border-t border-slate-800 pt-4 text-xs text-slate-500">
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {supplierName && <span>Поставщик: <span className="text-slate-300">{supplierName}</span></span>}
                <span>Выложен у поставщика: <span className="text-slate-300">{formatSupplierPublishedOn(local.supplier_published_on)}</span></span>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}

function formatSupplierPublishedOn(value?: string | null) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "Не указано";
}

function VariantFamiliesDialog({
  open,
  families,
  onClose,
  onDeleteFamily,
  onOpenProduct,
}: {
  open: boolean;
  families: VariantFamily[];
  onClose: () => void;
  onDeleteFamily: (family: VariantFamily) => Promise<void>;
  onOpenProduct: (product: CsvProduct) => void;
}) {
  const [openFamilyKey, setOpenFamilyKey] = useState<string | null>(null);
  const [deletingFamilyKey, setDeletingFamilyKey] = useState<string | null>(null);
  const openFamily = families.find((family) => family.key === openFamilyKey) || null;

  useEffect(() => {
    if (!open) setOpenFamilyKey(null);
  }, [open]);

  if (!open) return null;

  const deleteFamily = async (family: VariantFamily) => {
    setDeletingFamilyKey(family.key);
    try {
      await onDeleteFamily(family);
      if (openFamilyKey === family.key) setOpenFamilyKey(null);
    } finally {
      setDeletingFamilyKey(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/80 p-4" onMouseDown={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Семейные группы">
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <div>
            <h2 className="font-semibold text-white">Семейные группы</h2>
            <p className="mt-1 text-xs text-slate-400">{openFamily ? `${openFamily.title} · ${openFamily.products.length} товаров` : `Всего групп: ${families.length}`}</p>
          </div>
          <div className="flex items-center gap-2">
            {openFamily && <>
              <button type="button" onClick={() => void deleteFamily(openFamily)} disabled={deletingFamilyKey === openFamily.key} className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"><Trash2 className="h-4 w-4" />Удалить семью</button>
              <button type="button" onClick={() => setOpenFamilyKey(null)} className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white">Все семьи</button>
            </>}
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Закрыть"><X className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          {openFamily ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {openFamily.products.map((product) => {
                const colors = attributeValuesForDisplay(product.attributes?.colors ?? product.attributes?.color);
                return (
                  <button type="button" key={String(product.id || product.external_id)} onClick={() => { onOpenProduct(product); onClose(); }} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800 text-left transition hover:border-violet-400 hover:bg-slate-700/70">
                    <div className="relative aspect-[4/3] bg-slate-950">
                      {product.photos?.[0] ? <Image src={resizeImageUrl(product.photos[0], imagePresets.productGrid)} alt="" fill className="object-cover" unoptimized /> : <div className="flex h-full items-center justify-center text-xs text-slate-600">Нет фото</div>}
                    </div>
                    <div className="p-3">
                      <div className="line-clamp-2 text-xs font-semibold text-white">{product.name || "Без названия"}</div>
                      <div className="mt-1 truncate text-[11px] text-violet-300">{colors.join(", ") || "Цвет не указан"}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : families.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {families.map((family) => (
                <div key={family.key} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-700 bg-slate-800 p-3 text-left transition hover:border-violet-400 hover:bg-slate-800/80">
                  <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-950">
                    {family.products[0]?.photos?.[0] ? <Image src={resizeImageUrl(family.products[0].photos[0], imagePresets.productGrid)} alt="" fill className="object-cover" unoptimized /> : <div className="flex h-full items-center justify-center text-[10px] text-slate-600">Нет фото</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => setOpenFamilyKey(family.key)} className="block w-full truncate text-left text-sm font-semibold text-white">{family.title}</button>
                    <div className="mt-1 text-xs text-violet-300">{family.products.length} {family.products.length === 1 ? "товар" : family.products.length < 5 ? "товара" : "товаров"}</div>
                    <div className="mt-1 line-clamp-2 text-[11px] text-slate-500">{family.colors.join(", ") || "Цвета не указаны"}</div>
                  </div>
                  <button type="button" onClick={() => void deleteFamily(family)} disabled={deletingFamilyKey === family.key} className="shrink-0 rounded-lg p-2 text-red-300 hover:bg-red-500/10 disabled:opacity-50" title="Удалить семью вместе с товарами" aria-label={`Удалить семью ${family.title}`}><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          ) : <div className="py-16 text-center text-sm text-slate-500">В этой выгрузке пока нет семейных групп</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function BulkVariantFamilyDialog({
  open,
  batchId,
  selectedProductIds,
  families,
  onClose,
  onChanged,
}: {
  open: boolean;
  batchId: string;
  selectedProductIds: number[];
  families: VariantFamily[];
  onClose: () => void;
  onChanged: (productIds: number[], groupKey: string, groupName: string) => void;
}) {
  const [targetFamilyKey, setTargetFamilyKey] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const targetFamily = families.find((family) => family.key === targetFamilyKey) || null;

  useEffect(() => {
    if (!open) {
      setTargetFamilyKey(null);
      setError("");
      setGroupName("");
    }
  }, [open]);

  if (!open) return null;

  const apply = async () => {
    if (!selectedProductIds.length) return;
    if (!targetFamily && selectedProductIds.length < 2) {
      setError("Для новой семьи выберите минимум два товара");
      return;
    }
    if (!targetFamily && !groupName.trim()) {
      setError("Укажите название новой семьи");
      return;
    }
    setBusy(true);
    setError("");
    const result = await assignBatchVariantFamilyAction(
      batchId,
      selectedProductIds,
      targetFamily ? Number(targetFamily.products[0]?.id) : undefined,
      targetFamily ? undefined : groupName,
    );
    if (!result.success || !result.data?.groupKey) {
      setError(result.error || "Не удалось сохранить цветовую семью");
      setBusy(false);
      return;
    }
    onChanged(selectedProductIds, result.data.groupKey, result.data.groupName || groupName.trim());
    setBusy(false);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/80 p-4" onMouseDown={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Добавить в семейную группу">
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <div>
            <h2 className="font-semibold text-white">В семейную группу</h2>
            <p className="mt-1 text-xs text-slate-400">Выбрано товаров: {selectedProductIds.length}. Выберите существующую семью или создайте новую.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Закрыть"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          <button type="button" onClick={() => setTargetFamilyKey(null)} className={`mb-4 w-full rounded-xl border p-3 text-left transition ${targetFamily ? "border-slate-700 bg-slate-800 hover:border-slate-500" : "border-violet-400 bg-violet-500/15 ring-1 ring-violet-400/30"}`}>
            <div className="text-sm font-semibold text-white">Создать новую семью</div>
            <div className="mt-1 text-xs text-slate-400">Объединит выбранные товары в отдельную цветовую семью.</div>
          </button>
          {!targetFamily && (
            <label className="mb-5 block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-400">Название группы</span>
              <input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Например: BC0013 — лоферы"
                autoFocus
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500"
              />
            </label>
          )}
          <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Или добавить в существующую</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {families.map((family) => (
              <button type="button" key={family.key} onClick={() => setTargetFamilyKey(family.key)} className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition ${targetFamilyKey === family.key ? "border-violet-400 bg-violet-500/15 ring-1 ring-violet-400/30" : "border-slate-700 bg-slate-800 hover:border-slate-500"}`}>
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-950">
                  {family.products[0]?.photos?.[0] ? <Image src={resizeImageUrl(family.products[0].photos[0], imagePresets.productGrid)} alt="" fill className="object-cover" unoptimized /> : null}
                </div>
                <div className="min-w-0"><div className="truncate text-sm font-semibold text-white">{family.title}</div><div className="mt-1 text-xs text-violet-300">{family.products.length} товаров</div></div>
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-slate-700 px-5 py-4">
          {error && <div className="mb-3 text-sm text-red-300">{error}</div>}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-white">Отмена</button>
            <button type="button" onClick={apply} disabled={busy || !selectedProductIds.length} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50">{busy ? "Сохраняем…" : targetFamily ? "Добавить в семью" : "Создать семью"}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function VariantFamilyManager({
  product,
  products,
  batchId,
  onChanged,
}: {
  product: CsvProduct;
  products: CsvProduct[];
  batchId: string;
  onChanged: (productIds: number[], groupKey: string | null, groupName?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [groupName, setGroupName] = useState("");
  const productId = Number(product.id);
  const currentFamily = approvedVariantGroupKey(product);

  const familySizes = useMemo(() => {
    const sizes = new Map<string, number>();
    products.forEach((candidate) => {
      const key = approvedVariantGroupKey(candidate);
      if (key) sizes.set(key, (sizes.get(key) || 0) + 1);
    });
    return sizes;
  }, [products]);

  const candidates = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return products
      .filter((candidate) => {
        const candidateId = Number(candidate.id);
        const family = approvedVariantGroupKey(candidate);
        if (!Number.isInteger(candidateId) || candidateId === productId || (currentFamily && family === currentFamily)) return false;
        if (!needle) return true;
        const colors = attributeValuesForDisplay(candidate.attributes?.colors ?? candidate.attributes?.color);
        return [candidate.name, candidate.external_id, candidate.attributes?.model_code, ...colors]
          .some((value) => String(value || "").toLocaleLowerCase("ru-RU").includes(needle));
      })
      .sort((left, right) => {
        const leftScore = Number(left.brand === product.brand) + Number(left.category === product.category) + Number(left.subcategory === product.subcategory);
        const rightScore = Number(right.brand === product.brand) + Number(right.category === product.category) + Number(right.subcategory === product.subcategory);
        return rightScore - leftScore;
      })
      .slice(0, 100);
  }, [currentFamily, product.brand, product.category, product.subcategory, productId, products, query]);

  const selectedProducts = candidates.filter((candidate) => selectedIds.has(Number(candidate.id)));
  const selectedExistingFamily = selectedProducts.find((candidate) => approvedVariantGroupKey(candidate));

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const toggleCandidate = (candidate: CsvProduct) => {
    const id = Number(candidate.id);
    const candidateFamily = approvedVariantGroupKey(candidate);
    setSelectedIds((previous) => {
      if (candidateFamily) return previous.has(id) && previous.size === 1 ? new Set() : new Set([id]);
      const next = new Set([...previous].filter((selectedId) => {
        const selected = products.find((item) => Number(item.id) === selectedId);
        return selected && !approvedVariantGroupKey(selected);
      }));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applySelection = async () => {
    if (!Number.isInteger(productId) || !selectedProducts.length) return;
    setBusy(true);
    setError("");
    const result = selectedExistingFamily
      ? await assignBatchVariantFamilyAction(batchId, [productId], Number(selectedExistingFamily.id))
      : currentFamily
        ? await assignBatchVariantFamilyAction(batchId, selectedProducts.map((candidate) => Number(candidate.id)), productId)
        : await assignBatchVariantFamilyAction(batchId, [productId, ...selectedProducts.map((candidate) => Number(candidate.id))], undefined, groupName);
    if (!result.success) {
      setError(result.error || "Не удалось изменить цветовую семью");
      setBusy(false);
      return;
    }
    const affectedIds = selectedExistingFamily
      ? [productId]
      : currentFamily
        ? selectedProducts.map((candidate) => Number(candidate.id))
        : [productId, ...selectedProducts.map((candidate) => Number(candidate.id))];
    const nextGroupKey = result.data?.groupKey || currentFamily || (selectedExistingFamily ? approvedVariantGroupKey(selectedExistingFamily) : "");
    const nextGroupName = result.data?.groupName
      || (currentFamily || selectedExistingFamily ? String(product.variant_group_name || selectedExistingFamily?.variant_group_name || "") : groupName.trim());
    onChanged(affectedIds, nextGroupKey, nextGroupName);
    setBusy(false);
    setSelectedIds(new Set());
    setOpen(false);
  };

  const detach = async () => {
    if (!Number.isInteger(productId)) return;
    setBusy(true);
    setError("");
    const result = await detachBatchVariantProductAction(batchId, productId);
    if (!result.success) {
      setError(result.error || "Не удалось отвязать товар");
      setBusy(false);
      return;
    }
    onChanged([productId], null, "");
    setBusy(false);
    setOpen(false);
  };

  const actionLabel = selectedExistingFamily
    ? "Привязать к выбранной семье"
    : currentFamily
      ? "Добавить в текущую семью"
      : "Создать цветовую семью";

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setError(""); setGroupName(""); }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2.5 py-1.5 text-xs font-semibold text-violet-300 hover:bg-violet-500/20"
      >
        <Link2 className="h-3.5 w-3.5" />
        Управлять
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/80 p-4" onMouseDown={() => setOpen(false)}>
          <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Управление цветовыми вариантами">
            <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
              <div>
                <h2 className="font-semibold text-white">Цветовые варианты товара</h2>
                <p className="mt-1 text-xs text-slate-400">Выберите товары без семьи или один товар из уже существующей семьи.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </div>
            <div className="border-b border-slate-800 px-5 py-3">
              <label className="relative block">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus placeholder="Название, артикул, модель или цвет" className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-3 text-sm text-white outline-none focus:border-violet-500" />
              </label>
              {!currentFamily && (
                <label className="mt-3 block">
                  <span className="mb-1 block text-xs font-semibold text-slate-400">Название новой группы</span>
                  <input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Например: BC0013 — лоферы" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-500" />
                </label>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
              {candidates.length ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {candidates.map((candidate) => {
                    const id = Number(candidate.id);
                    const selected = selectedIds.has(id);
                    const family = approvedVariantGroupKey(candidate);
                    const colors = attributeValuesForDisplay(candidate.attributes?.colors ?? candidate.attributes?.color);
                    return (
                      <button type="button" key={id} onClick={() => toggleCandidate(candidate)} className={`flex min-w-0 gap-3 rounded-xl border p-2 text-left transition ${selected ? "border-violet-400 bg-violet-500/15 ring-1 ring-violet-400/30" : "border-slate-700 bg-slate-800 hover:border-slate-500"}`}>
                        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-950">
                          {candidate.photos?.[0] ? <Image src={resizeImageUrl(candidate.photos[0], imagePresets.productGrid)} alt="" fill className="object-cover" unoptimized /> : <div className="flex h-full items-center justify-center text-[10px] text-slate-600">Нет фото</div>}
                        </div>
                        <div className="min-w-0 flex-1 py-0.5">
                          <div className="line-clamp-2 text-xs font-semibold text-white">{candidate.name || "Без названия"}</div>
                          <div className="mt-1 truncate text-[11px] text-violet-300">{colors.join(", ") || "Цвет не указан"}</div>
                          <div className="mt-1 truncate text-[10px] text-slate-500">{candidate.external_id}</div>
                          {family && <div className="mt-1 inline-flex rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">Семья: {familySizes.get(family) || 1}</div>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : <div className="py-12 text-center text-sm text-slate-500">Подходящие товары не найдены</div>}
            </div>
            <div className="border-t border-slate-700 bg-slate-900 px-5 py-4">
              {error && <div className="mb-3 text-sm text-red-300">{error}</div>}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>{currentFamily && <button type="button" onClick={detach} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50"><Unlink className="h-3.5 w-3.5" />Отвязать текущий товар</button>}</div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-white">Отмена</button>
                  <button type="button" onClick={applySelection} disabled={busy || !selectedProducts.length} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-40">{busy ? "Сохраняем…" : actionLabel}</button>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
