"use client";

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
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
} from "lucide-react";
import {
  pushCsvProductsAction,
  fetchLookupsAction,
  readLocalCsvAction,
  saveLocalCsvAction,
  getBatchProductsAction,
  saveBatchProductsAction,
  updateBatchProductAction,
  deleteBatchProductAction,
  exportBatchProductsCsvAction,
  recordAiTaskAction,
  getSupplierDataAction,
  runCustomSupplierScriptAction,
  type CsvProduct,
  type Lookups,
} from "@/actions/csv-import";
import {
  createBatchAction,
  updateBatchStageAction,
  linkBatchToTaskAction,
} from "@/actions/suppliers";
import { processAiAction, targetedAiEditAction } from "@/actions/ai-process";
import Image from "next/image";
import Link from "next/link";

const IMG_SUFFIX =
  "?imageMogr2/auto-orient/thumbnail/!320x320r/quality/100/format/jpg";

const DEFAULT_PRODUCT_COLUMNS = [
  { name: "external_id", key: "external_id" },
  { name: "name", key: "name" },
  { name: "description", key: "description" },
  { name: "price", key: "price" },
  { name: "status", key: "status" },
  { name: "brand", key: "brand" },
  { name: "category", key: "category" },
  { name: "subcategory", key: "subcategory" },
  { name: "gender", key: "gender" },
  { name: "photos", key: "photos" },
  { name: "ai_processed", key: "ai_processed" },
];

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
        }
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
  initialRawPath = "",
  initialAiPath = "",
  initialSupplierId = null,
  initialBatchId = null,
  initialFallbackBatchId = null,
  initialSupplierName = null,
  initialSupplierAvatar = null,
  onClose,
}: {
  initialLocalPath?: string;
  initialRawPath?: string;
  initialAiPath?: string;
  initialSupplierId?: number | null;
  initialBatchId?: string | null;
  initialFallbackBatchId?: string | null;
  initialSupplierName?: string | null;
  initialSupplierAvatar?: string | null;
  onClose?: () => void;
}) {
  const [products, setProducts] = useState<CsvProduct[]>([]);
  const [columns, setColumns] = useState<{ name: string; key: string }[]>([]);
  const [delimiter, setDelimiter] = useState(",");
  const [fileName, setFileName] = useState("");
  const [isPushing, setIsPushing] = useState(false);
  const [result, setResult] = useState<{
    success: number;
    failed: number;
    errors: string[];
  } | null>(null);
  const [pushProgress, setPushProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [selectedForMerge, setSelectedForMerge] = useState<number[]>([]); // Список индексов в порядке выбора
  const [previousProducts, setPreviousProducts] = useState<CsvProduct[] | null>(
    null,
  ); // Для отмены объединения

  // Local file mode
  const [importMode, setImportMode] = useState<"upload" | "local">("upload");
  const [localPath, setLocalPath] = useState("");
  const [isLoadingPath, setIsLoadingPath] = useState(false);
  
  const [batchName, setBatchName] = useState("");
  const [isBatchActive, setIsBatchActive] = useState(false);
  const [pathError, setPathError] = useState("");

  // Dirty flag — были ли изменения с момента последнего сохранения
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [filterBrand, setFilterBrand] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSubcategory, setFilterSubcategory] = useState("");
  const [filterGender, setFilterGender] = useState("");
  const [bulkBrand, setBulkBrand] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkSubcategory, setBulkSubcategory] = useState("");
  const [supplierId, setSupplierId] = useState<number | null>(initialSupplierId);
  const [batchId, setBatchId] = useState<string | null>(initialBatchId);
  const isBatchSource = Boolean(batchId);

  const [isAiProcessed, setIsAiProcessed] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const isAiStoppedRef = useRef(false)
  const [aiProgress, setAiProgress] = useState<{current: number, total: number} | null>(null);
  const [supplierData, setSupplierData] = useState<{album_id: string, post_process_script: string | null, ai_parallel_enabled?: boolean, ai_parallel_count?: number} | null>(null);
  const [isRunningCustomScript, setIsRunningCustomScript] = useState(false);
  const [targetedAiInstruction, setTargetedAiInstruction] = useState("");
  const [isTargetedAiEditing, setIsTargetedAiEditing] = useState(false);
  const [targetedAiMsg, setTargetedAiMsg] = useState<string | null>(null);
  const [targetedAiUsePhoto, setTargetedAiUsePhoto] = useState(false);
  const [targetedAiProgress, setTargetedAiProgress] = useState<{ current: number; total: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchLookupsAction().then(setLookups).catch(console.error);

    if (initialSupplierId) {
      setSupplierId(initialSupplierId);
      getSupplierDataAction(initialSupplierId).then(setSupplierData).catch(console.error);
    }
    if (initialBatchId) {
      setBatchId(initialBatchId);
      handleLoadBatch(initialBatchId);
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
  }, [initialLocalPath, initialSupplierId, initialBatchId]);


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
      return true;
    });
  }, [products, filterBrand, filterCategory, filterSubcategory, filterGender]);

  const handleModeChange = (mode: "upload" | "local") => {
    setImportMode(mode);
    localStorage.setItem("csv_import_mode", mode);
    setProducts([]);
    setColumns([]);
    setResult(null);
    setFileName("");
    setIsDirty(false);
    setSaveMsg(null);
    setIsAiProcessed(false);
    setFilterBrand("");
    setFilterCategory("");
    setFilterSubcategory("");
    setFilterGender("");
    setBulkBrand("");
    setBulkCategory("");
    setBulkSubcategory("");
    setSelectedForMerge([]);
    setPreviousProducts(null);
  };

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
      setIsAiProcessed(false);
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
      localStorage.setItem("csv_local_path", path);

      // Проверяем, действительно ли ВСЕ товары обработаны
      const allProcessed = products.length > 0 && products.every(p => {
          const val = (p as any).ai_processed;
          return val === true || val === "true" || val === "True";
      });
      setIsAiProcessed(allProcessed);
    } else {
      if (initialFallbackBatchId) {
        setSaveMsg("Файл недоступен на сервере, открываю текущие товары партии из БД");
        setBatchId(initialFallbackBatchId);
        await handleLoadBatch(initialFallbackBatchId);
      } else {
        setPathError(res.error || "Не удалось прочитать файл");
      }
    }
    setIsLoadingPath(false);
  };

  const handleLoadBatch = async (nextBatchId: string) => {
    setIsLoadingPath(true);
    setPathError("");
    setResult(null);
    setSaveMsg(null);
    setIsDirty(false);
    const res = await getBatchProductsAction(nextBatchId);
    if (res.success && res.data) {
      setProducts(res.data.products);
      setColumns(res.data.columns?.length ? res.data.columns : DEFAULT_PRODUCT_COLUMNS);
      setDelimiter(res.data.delimiter || ";");
      setFileName(`Партия ${nextBatchId.slice(0, 8)}`);
      const allProcessed =
        res.data.products.length > 0 &&
        res.data.products.every((p: any) => p.ai_processed === true || p.ai_processed === "true");
      setIsAiProcessed(allProcessed);
      setImportMode("local");
    } else {
      setPathError(res.error || "Не удалось загрузить товары партии");
    }
    setIsLoadingPath(false);
  };

  const persistBatchProducts = async (nextProducts: CsvProduct[]) => {
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

  const exportBatchCsv = async () => {
    if (!batchId) return;
    const res = await exportBatchProductsCsvAction(batchId);
    if (!res.success || !res.data) {
      setSaveMsg("✗ Ошибка экспорта: " + ((res as any).error || "unknown"));
      return;
    }
    const exportData = res.data as { fileName: string; content: string };
    const blob = new Blob([exportData.content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportData.fileName;
    link.click();
    URL.revokeObjectURL(url);
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
  const handlePush = async () => {
    if (products.length === 0) return;
    setIsPushing(true);
    setResult(null);
    setPushProgress({ current: 0, total: products.length });

    let currentBatchId: string | undefined = undefined;

    // Если указано имя партии, создаем её перед началом импорта
    if (batchName.trim()) {
      try {
        const batchRes = await createBatchAction(batchName.trim(), undefined, products.length);
        if (batchRes.success && batchRes.data?.id) {
          currentBatchId = batchRes.data.id;
          
          // Попробуем связать с задачей из истории
          if (localPath) {
            const taskMatch = localPath.match(/task_(\d+)/);
            if (taskMatch && taskMatch[1]) {
              await linkBatchToTaskAction(currentBatchId, parseInt(taskMatch[1]));
            }
          }
        } else {
          console.error("Failed to create batch:", batchRes.error);
        }
      } catch (err) {
        console.error("Batch creation error:", err);
      }
    }

    const CHUNK_SIZE = 20;
    const total = products.length;
    const errors: string[] = [];
    let success = 0;
    let failed = 0;
    
    // Создаем копию всех товаров для постепенного обновления
    let currentProducts = [...products];

    try {
      for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = products.slice(i, i + CHUNK_SIZE);
        setPushProgress({ current: i, total });

        // Определяем, какой ID партии использовать: свежесозданный или тот, что уже был у задачи
        const effectiveBatchId = currentBatchId || batchId;

        // Добавляем batchId к каждому товару в чанке
        const chunkWithBatch = chunk.map(p => ({
            ...p,
            batchId: effectiveBatchId || undefined
        }));

        const res = await pushCsvProductsAction(chunkWithBatch);
        if (res.success && res.data) {
          success += res.data.success;
          failed += res.data.failed;
          errors.push(...res.data.errors);
          
          if (res.data.updatedProducts) {
             // Заменяем старые товары на обновленные (со ссылками S3) в нашем массиве
             res.data.updatedProducts.forEach((updatedProduct: any, idx: number) => {
                 currentProducts[i + idx] = updatedProduct;
             });
          }
        } else {
          failed += chunk.length;
          errors.push(
            res.error || "Server error on chunk " + (i / CHUNK_SIZE + 1),
          );
        }

        // Обновляем состояние после каждого чанка, чтобы UI видел новые ссылки S3
        setProducts([...currentProducts]);
        
        // --- СОХРАНЕНИЕ ПРОГРЕССА ПОСЛЕ КАЖДОЙ ПАЧКИ ---
        if (batchId) {
           try {
             await saveBatchProductsAction(batchId, currentProducts);
           } catch(e) {
             console.warn("Failed to save intermediate DB state:", e);
           }
        } else if (localPath) {
           try {
             await saveLocalCsvAction(localPath, currentProducts, columns, delimiter);
           } catch(e) {
             console.warn("Failed to save intermediate state:", e);
           }
        }
      }
      
      setResult({ success, failed, errors });

      // Если все прошло успешно (или почти все), обновляем статус партии на PUSHED
      const finalBatchId = currentBatchId || batchId;
      if (finalBatchId && success > 0) {
          await updateBatchStageAction(finalBatchId, 'PUSHED');
      }
    } catch (e: any) {
      setResult({
        success,
        failed,
        errors: [...errors, "Network or unexpected error: " + e.message],
      });
    }

    setPushProgress(null);
    setIsPushing(false);
  };

  const handleAiProcess = async () => {
    if (!supplierId && products.length > 0) {
        alert("ID поставщика не найден. Пожалуйста, запустите обработку из истории выгрузок.");
        return;
    }
    
    setIsProcessing(true);
    isAiStoppedRef.current = false;

    let currentAiPath = localPath;
    let effectiveProducts = [...products];
    let effectiveColumns = [...columns];

    // Убедимся, что колонка ai_processed существует, чтобы сохранять статус
    if (!effectiveColumns.some(c => c.key === 'ai_processed')) {
        effectiveColumns.push({ name: 'ai_processed', key: 'ai_processed' });
        setColumns(effectiveColumns);
    }

    // В legacy file mode создаем новый AI CSV; в batch mode рабочее состояние сразу пишется в БД.
    if (!batchId && !localPath.includes('task_ai_')) {
        try {
            const recordRes = await recordAiTaskAction({
                supplierId,
                batchId,
                products: effectiveProducts,
                columns: effectiveColumns,
                delimiter
            });
            if (recordRes.success && recordRes.path) {
                currentAiPath = recordRes.path;
                setLocalPath(currentAiPath);
                localStorage.setItem("csv_local_path", currentAiPath);
                setSaveMsg("✓ Создан файл для ИИ-обработки");
            } else {
                alert("Ошибка при создании файла для ИИ: " + recordRes.error);
                setIsProcessing(false);
                return;
            }
        } catch (e: any) {
            alert("Критическая ошибка: " + e.message);
            setIsProcessing(false);
            return;
        }
    }

    const isParallel = supplierData?.ai_parallel_enabled ?? false;
    const parallelCount = supplierData?.ai_parallel_count ?? 5;
    
    // Если многопоточность выключена (важно для кэша), то отправляем по 5 товаров.
    // Скрипт Питона обработает их СТРОГО ПО ОЧЕРЕДИ: первый обработает -> запишет в кэш -> второй возьмет из кэша.
    // Если включена, отправляем порцию равную количеству потоков * 2, чтобы загрузить потоки.
    const CHUNK_SIZE = isParallel ? Math.max(5, parallelCount * 2) : 5;

    const total = effectiveProducts.length;
    let processedCount = effectiveProducts.filter(p => {
        const val = (p as any).ai_processed;
        return val === true || val === "true" || val === "True";
    }).length;
    
    setAiProgress({ current: processedCount, total });

    for (let i = 0; i < total; i += CHUNK_SIZE) {
        if (isAiStoppedRef.current) {
            setSaveMsg("Обработка остановлена пользователем");
            break;
        }

        const chunk = effectiveProducts.slice(i, i + CHUNK_SIZE);
        const unprocessedChunk = chunk.filter(p => {
            const val = (p as any).ai_processed;
            return val !== true && val !== "true" && val !== "True";
        });

        if (unprocessedChunk.length > 0) {
            // Вызов процесса ИИ без передачи currentAiPath, чтобы не делать бэкапы на каждый чанк
            const res = await processAiAction(supplierId!, unprocessedChunk, undefined);
            
            if (res.success && res.data) {
                res.data.forEach((updatedProduct: any) => {
                    const idx = effectiveProducts.findIndex(p => p.external_id === updatedProduct.external_id);
                    if (idx !== -1) {
                        effectiveProducts[idx] = { ...effectiveProducts[idx], ...updatedProduct, ai_processed: true };
                    }
                });
                
                processedCount += unprocessedChunk.length;
                setAiProgress({ current: processedCount, total });
                setProducts([...effectiveProducts]);
                
                try {
                    if (batchId) {
                      await saveBatchProductsAction(batchId, effectiveProducts);
                    } else {
                      await saveLocalCsvAction(currentAiPath, effectiveProducts, effectiveColumns, delimiter);
                    }
                } catch(e) {
                    console.warn("Failed to save intermediate AI state:", e);
                }
            } else {
                alert("Ошибка ИИ на части товаров: " + res.error);
                break;
            }
        }
    }
    
    const allProcessed = effectiveProducts.every(p => {
        const val = (p as any).ai_processed;
        return val === true || val === "true" || val === "True";
    });
    
    setIsAiProcessed(allProcessed);
    if (batchId && allProcessed) {
      await updateBatchStageAction(batchId, 'AI_PROCESSED');
    }
    setIsDirty(false);
    setTimeout(() => setSaveMsg(null), 5000);
    setIsProcessing(false);
    setAiProgress(null);
  };

  const handleStopAi = () => {
      isAiStoppedRef.current = true;
  };

  const handleCustomScriptProcess = async () => {
    if (!supplierId || (!localPath && !batchId)) return;
    setIsRunningCustomScript(true);
    setSaveMsg("Запуск скрипта...");
    
    const res = await runCustomSupplierScriptAction(localPath || null, supplierId, batchId);
    
    if (res.success && res.path) {
        if (batchId) {
          await handleLoadBatch(batchId);
        } else {
          setLocalPath(res.path);
          localStorage.setItem("csv_local_path", res.path);
          await handleLoadPath(res.path);
        }
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
      const currentProduct = products[index];
      setProducts((prev) =>
        prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
      );
      setIsDirty(true);
      if (batchId && currentProduct) {
        const identifier = currentProduct.id || currentProduct.external_id;
        if (identifier) {
          updateBatchProductAction(identifier, { [field]: value } as Partial<CsvProduct>, batchId)
            .then((res) => {
              if (res.success) {
                setIsDirty(false);
                setSaveMsg("✓ Сохранено в БД");
                setTimeout(() => setSaveMsg(null), 2500);
              } else {
                setSaveMsg("✗ Ошибка БД: " + (res.error || "unknown"));
              }
            })
            .catch((error) => setSaveMsg("✗ Ошибка БД: " + error.message));
        }
      }
    },
    [batchId, products],
  );

  const handleRemove = useCallback((index: number) => {
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
  }, [batchId, products]);

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
    setSelectedForMerge([]);
    setPreviousProducts(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const toggleMergeSelection = useCallback((index: number) => {
    setSelectedForMerge((prev) => {
      if (prev.includes(index)) return prev.filter((i) => i !== index);
      return [...prev, index];
    });
  }, []);

  const handleSelectFiltered = () => {
    setSelectedForMerge(filteredProducts.map((product) => products.indexOf(product)));
  };

  const handleBulkApply = () => {
    const updates: Partial<CsvProduct> = {};
    if (bulkBrand) updates.brand = bulkBrand;
    if (bulkCategory) updates.category = bulkCategory;
    if (bulkSubcategory) updates.subcategory = bulkSubcategory;
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
    setIsDirty(true);
  };

  const handleMergePhotos = () => {
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
    if (previousProducts) {
      setProducts(previousProducts);
      setPreviousProducts(null);
      setIsDirty(true);
      if (batchId) persistBatchProducts(previousProducts);
    }
  };

  const handleTargetedAiEdit = async () => {
    if (!targetedAiInstruction.trim() || products.length === 0 || !lookups) return;

    const targetIndices = selectedForMerge.length > 0
      ? selectedForMerge
      : filteredProducts.map((product) => products.indexOf(product)).filter((index) => index >= 0);

    if (targetIndices.length === 0) return;

    if (
      selectedForMerge.length === 0 &&
      targetIndices.length === products.length &&
      !confirm(`Будут обработаны все ${targetIndices.length} товаров. Продолжить?`)
    ) {
      return;
    }

    setIsTargetedAiEditing(true);
    setTargetedAiMsg(null);
    setTargetedAiProgress({ current: 0, total: targetIndices.length });

    const CHUNK_SIZE = 10;
    const errors: string[] = [];
    let appliedCount = 0;
    let nextProducts: CsvProduct[] = [...products];
    setPreviousProducts([...products]);

    for (let offset = 0; offset < targetIndices.length; offset += CHUNK_SIZE) {
      const chunkIndices = targetIndices.slice(offset, offset + CHUNK_SIZE);
      const items = chunkIndices.map((index) => ({
        index,
        product: nextProducts[index],
        previousProduct: index > 0 ? nextProducts[index - 1] : null,
        nextProduct: index + 1 < nextProducts.length ? nextProducts[index + 1] : null,
      }));

      const res = await targetedAiEditAction({
        instruction: targetedAiInstruction,
        items,
        lookups,
        supplierId,
        includePhotos: targetedAiUsePhoto,
        batchId,
        currentPath: localPath,
      });

      const patches = res.data?.patches || [];
      const chunkErrors = res.data?.errors || (res.error ? [res.error] : []);
      errors.push(...chunkErrors);

      if (patches.length > 0) {
        nextProducts = nextProducts.map((product, index) => {
          const patch = patches.find((item: any) => item.index === index)?.patch;
          return patch ? { ...product, ...patch } : product;
        });
        appliedCount += patches.length;
        setProducts([...nextProducts]);
        setIsDirty(true);

        if (batchId) {
          const saveRes = await saveBatchProductsAction(batchId, nextProducts);
          if (saveRes.success) {
            setIsDirty(false);
          } else {
            errors.push(`Ошибка сохранения БД: ${saveRes.error || "unknown"}`);
            break;
          }
        } else if (localPath) {
          const saveRes = await saveLocalCsvAction(localPath, nextProducts, columns, delimiter);
          if (saveRes.success) {
            setIsDirty(false);
          } else {
            errors.push(`Ошибка сохранения: ${saveRes.error || "unknown"}`);
            break;
          }
        }
      }

      setTargetedAiProgress({
        current: Math.min(offset + chunkIndices.length, targetIndices.length),
        total: targetIndices.length,
      });
    }

    setTargetedAiMsg(
      errors.length
        ? `✓ Обновлено ${appliedCount}, ошибок ${errors.length}`
        : `✓ Обновлено ${appliedCount} товаров`
    );
    setTimeout(() => setTargetedAiMsg(null), 6000);
    setTargetedAiProgress(null);
    setIsTargetedAiEditing(false);
  };

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 font-sans">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
        {onClose && (
          <div className="mb-4 flex justify-end">
            <button
              onClick={onClose}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700"
            >
              <X size={18} />
              Закрыть
            </button>
          </div>
        )}
        
        {/* Compact Mode Switchers */}
        {!isBatchSource && (
        <div className="flex items-center gap-4 mb-8 bg-slate-800/50 p-1.5 rounded-xl border border-slate-700/50 w-fit">
          <button
            onClick={() => handleModeChange("upload")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${importMode === "upload" ? "bg-emerald-600 text-white shadow-lg" : "text-slate-400 hover:text-slate-200"}`}
          >
            <Upload className="w-4 h-4" />
            Загрузка файла
          </button>
          <button
            onClick={() => handleModeChange("local")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${importMode === "local" ? "bg-indigo-600 text-white shadow-lg" : "text-slate-400 hover:text-slate-200"}`}
          >
            <HardDrive className="w-4 h-4" />
            Локальный файл
          </button>
        </div>
        )}

        {/* Global Action Bar (only when products are loaded) */}
        {products.length > 0 && (
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4 mb-8 flex flex-col md:flex-row items-center justify-between gap-4 shadow-xl">
            <div className="flex items-center gap-4">
              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Выбрано</span>
                <span className="text-lg font-bold text-white">
                  {products.length} <span className="text-sm font-normal text-slate-400">товаров</span>
                </span>
              </div>
              
              <div className="h-10 w-px bg-slate-700 mx-2 hidden md:block" />

              <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Обработка</span>
                <span className={`text-sm font-bold flex items-center gap-1.5 ${isAiProcessed ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {isAiProcessed ? (
                    <><CheckCircle size={14} /> Обработано ИИ</>
                  ) : (
                    <><AlertTriangle size={14} /> Сырая выгрузка</>
                  )}
                </span>
              </div>
              
              {initialSupplierName && (
                <>
                  <div className="h-10 w-px bg-slate-700 mx-2 hidden md:block" />
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-700 border border-slate-600 flex-shrink-0 flex items-center justify-center">
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
              {previousProducts && (
                <button
                  onClick={handleUndoMerge}
                  className="px-4 py-2 text-sm font-medium bg-slate-700 hover:bg-slate-600 text-amber-400 border border-amber-500/30 rounded-lg transition-all flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Отменить изменения
                </button>
              )}

              {(importMode === "local" || isBatchSource) && (
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
                  {saveMsg && (
                    <span className={`absolute -bottom-6 text-[10px] font-bold whitespace-nowrap animate-in fade-in slide-in-from-top-1 ${saveMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>
                      {saveMsg}
                    </span>
                  )}
                </div>
              )}

              {isBatchSource && (
                <button
                  onClick={exportBatchCsv}
                  className="px-4 py-2 text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 rounded-lg transition-all flex items-center gap-2"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  Скачать CSV
                </button>
              )}

              {isBatchSource ? (
                <button
                  onClick={() => batchId && handleLoadBatch(batchId)}
                  disabled={isLoadingPath}
                  className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingPath ? "animate-spin" : ""}`} />
                  Обновить из БД
                </button>
              ) : (
                <button
                  onClick={handleClear}
                  className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                >
                  Очистить
                </button>
              )}

              {supplierData?.post_process_script && (
                <button
                    onClick={handleCustomScriptProcess}
                    disabled={isRunningCustomScript}
                    className="px-4 py-2.5 text-sm font-bold bg-amber-600 hover:bg-amber-500 text-white rounded-xl transition-all shadow-lg shadow-amber-600/20 flex items-center gap-2 disabled:opacity-50"
                    title={`Скрипт: ${supplierData.post_process_script}`}
                >
                    {isRunningCustomScript ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                        <Filter className="w-4 h-4" />
                    )}
                    Пост-обработка скриптом
                </button>
              )}

              {!isAiProcessed ? (
                isProcessing ? (
                  <button
                      onClick={handleStopAi}
                      className="px-6 py-2.5 text-sm font-bold bg-red-600 hover:bg-red-500 text-white rounded-xl transition-all shadow-lg shadow-red-600/20 flex items-center gap-2"
                  >
                      <Square className="w-4 h-4 fill-current" />
                      Стоп ИИ ({aiProgress ? `${aiProgress.current}/${aiProgress.total}` : "..."})
                  </button>
                ) : (
                  <button
                      onClick={handleAiProcess}
                      className="px-6 py-2.5 text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center gap-2"
                  >
                      <Zap className="w-4 h-4 text-amber-300 fill-amber-300" />
                      Обработать с ИИ
                  </button>
                )
              ) : (
                <button
                    onClick={handlePush}
                    disabled={isPushing}
                    className="px-6 py-2.5 text-sm font-bold bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white rounded-xl transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2 disabled:opacity-50"
                >
                    {isPushing ? (
                    <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        {pushProgress ? `${pushProgress.current}/${pushProgress.total}` : "..."}
                    </>
                    ) : (
                    <>
                        <Send className="w-4 h-4" />
                        Запушить в основную базу
                    </>
                    )}
                </button>
              )}
            </div>
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
                    <p className="mt-2 text-sm text-red-400 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" /> {pathError}
                    </p>
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
                    Результаты импорта
                  </h3>
                  <p className="text-sm text-slate-400">
                    Успешно:{" "}
                    <span className="text-emerald-400 font-bold">
                      {result.success}
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
        {products.length > 0 && fileName && (
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
                <h4 className="text-sm font-medium text-white">{fileName}</h4>
                <p className="text-xs text-slate-500">
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

        {/* Filters */}
        {products.length > 0 &&
          (uniqueBrands.length > 1 ||
            uniqueCategories.length > 1 ||
            uniqueSubcategories.length > 1 ||
            uniqueGenders.length > 1) && (
            <div className="mb-6 flex flex-wrap items-center gap-3 p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
              <div className="flex items-center gap-2 text-slate-500 mr-1">
                <Filter className="w-4 h-4" />
                <span className="text-xs font-medium uppercase tracking-wider">
                  Фильтры
                </span>
              </div>

              {uniqueBrands.length > 1 && (
                <select
                  value={filterBrand}
                  onChange={(e) => setFilterBrand(e.target.value)}
                  className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500 transition-colors min-w-[160px]"
                >
                  <option value="">Все бренды</option>
                  {uniqueBrands.map((id) => (
                    <option key={id} value={id}>
                      {id === "__EMPTY__"
                        ? "Без бренда"
                        : resolveName(id, lookups?.brands || [])}
                    </option>
                  ))}
                </select>
              )}

              {uniqueCategories.length > 1 && (
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500 transition-colors min-w-[160px]"
                >
                  <option value="">Все категории</option>
                  {uniqueCategories.map((id) => (
                    <option key={id} value={id}>
                      {id === "__EMPTY__"
                        ? "Без категории"
                        : resolveName(id, lookups?.categories || [])}
                    </option>
                  ))}
                </select>
              )}

              {uniqueSubcategories.length > 1 && (
                <select
                  value={filterSubcategory}
                  onChange={(e) => setFilterSubcategory(e.target.value)}
                  className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500 transition-colors min-w-[180px]"
                >
                  <option value="">Все подкатегории</option>
                  {uniqueSubcategories.map((id) => (
                    <option key={id} value={id}>
                      {id === "__EMPTY__"
                        ? "Без подкатегории"
                        : resolveName(id, lookups?.subcategories || [])}
                    </option>
                  ))}
                </select>
              )}

              {uniqueGenders.length > 1 && (
                <select
                  value={filterGender}
                  onChange={(e) => setFilterGender(e.target.value)}
                  className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-indigo-500 transition-colors min-w-[140px]"
                >
                  <option value="">Все гендеры (Для кого)</option>
                  {uniqueGenders.map((g) => (
                    <option key={g} value={g}>
                      {g === "__EMPTY__" ? "Без гендера" : g}
                    </option>
                  ))}
                </select>
              )}

              {(filterBrand ||
                filterCategory ||
                filterSubcategory ||
                filterGender) && (
                  <button
                    onClick={() => {
                      setFilterBrand("");
                      setFilterCategory("");
                      setFilterSubcategory("");
                      setFilterGender("");
                    }}
                    className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-slate-700 transition-colors"
                  >
                    Сбросить
                  </button>
                )}

              {(filterBrand ||
                filterCategory ||
                filterSubcategory ||
                filterGender) && (
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

        {products.length > 0 && (
          <div className="mb-6 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-white">Точечная AI-правка</div>
                <div className="text-xs text-slate-400">
                  Цель: {selectedForMerge.length > 0
                    ? `${selectedForMerge.length} выбранных`
                    : `${filteredProducts.length} показанных по фильтрам`}
                </div>
              </div>
              {targetedAiMsg && (
                <div className={`text-xs font-semibold ${targetedAiMsg.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`}>
                  {targetedAiMsg}
                </div>
              )}

            </div>

            <label className="mb-3 inline-flex items-center gap-2 text-xs font-medium text-slate-300">
              <input
                type="checkbox"
                checked={targetedAiUsePhoto}
                onChange={(event) => setTargetedAiUsePhoto(event.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-500"
              />
              Анализировать первое фото
            </label>

            <div className="flex flex-col gap-3 lg:flex-row">
              <textarea
                value={targetedAiInstruction}
                onChange={(event) => setTargetedAiInstruction(event.target.value)}
                rows={3}
                placeholder="Например: Поменяй подкатегорию, name и description у товаров с подкатегорией Комплекты. Комплектов там нет, это единичные товары. Проанализируй первое фото и исходный текст из соседних строк."
                className="min-h-[88px] flex-1 resize-y rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-600 focus:border-indigo-500"
              />
              <button
                onClick={handleTargetedAiEdit}
                disabled={isTargetedAiEditing || !targetedAiInstruction.trim() || filteredProducts.length === 0}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 lg:w-56"
              >
                {isTargetedAiEditing ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    {targetedAiProgress ? `${targetedAiProgress.current}/${targetedAiProgress.total}` : "Правлю..."}
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4 text-amber-300 fill-amber-300" />
                    Применить AI
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {products.length === 0 && isBatchSource && (
          <div className="mx-auto mb-10 max-w-2xl rounded-2xl border border-slate-700 bg-slate-800 p-10 text-center shadow-xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900">
              <Database className="h-7 w-7 text-slate-500" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-white">В партии нет товаров</h3>
            <p className="text-sm text-slate-400">
              Если товары были изменены через NocoDB, обновите партию из базы.
            </p>
            <button
              onClick={() => batchId && handleLoadBatch(batchId)}
              disabled={isLoadingPath}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isLoadingPath ? "animate-spin" : ""}`} />
              Обновить из БД
            </button>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 pb-48">
              {filteredProducts.map((product) => {
                const realIndex = products.indexOf(product);
                const selectionOrder = selectedForMerge.indexOf(realIndex);
                return (
                  <CsvProductCard
                    key={`${product.external_id}-${realIndex}`}
                    product={product}
                    index={realIndex}
                    lookups={lookups}
                    isSelected={selectionOrder !== -1}
                    selectionOrder={selectionOrder + 1}
                    onToggleSelection={() => toggleMergeSelection(realIndex)}
                    onRemove={handleRemove}
                    onUpdate={updateProduct}
                    onClick={() => setSelectedIdx(realIndex)}
                    localPath={localPath}
                  />
                );
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

                <div className="grid min-w-[min(760px,calc(100vw-3rem))] flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
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
                  onClick={handleBulkApply}
                  disabled={!bulkBrand && !bulkCategory && !bulkSubcategory}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50 disabled:grayscale"
                >
                  Применить поля
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

      {/* Drawer */}
      <CsvProductDrawer
        product={selectedIdx !== null ? products[selectedIdx] : null}
        index={selectedIdx ?? -1}
        lookups={lookups}
        isOpen={selectedIdx !== null}
        onClose={() => setSelectedIdx(null)}
        onUpdate={updateProduct}
      />
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
  onToggleSelection: () => void;
  onRemove: (i: number) => void;
  onUpdate: (i: number, f: keyof CsvProduct, v: any) => void;
  onClick: () => void;
  localPath?: string;
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
  localPath,
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
            src={product.photos[0] + IMG_SUFFIX}
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
            onToggleSelection();
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
}

function CsvProductDrawer({
  product,
  index,
  lookups,
  isOpen,
  onClose,
  onUpdate,
}: CsvProductDrawerProps) {
  const [local, setLocal] = useState<CsvProduct | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useEffect(() => {
    setLocal(product ? { ...product } : null);
  }, [product, isOpen]);

  if (!isOpen || !local) return null;

  const change = (field: keyof CsvProduct, value: any) => {
    setLocal((prev) => (prev ? { ...prev, [field]: value } : null));
    onUpdate(index, field, value);
  };

  const removePhoto = (i: number) =>
    change(
      "photos",
      local.photos.filter((_, j) => j !== i),
    );

  const onDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) return;
    const arr = [...local.photos];
    const dragged = arr[dragIdx];
    arr.splice(dragIdx, 1);
    arr.splice(i, 0, dragged);
    change("photos", arr);
    setDragIdx(i);
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-slate-900 shadow-2xl overflow-y-auto border-l border-slate-700">
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
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-lg"
            >
              <X size={20} />
            </button>
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
              {local.photos.length > 0 ? (
                <div className="grid grid-cols-3 gap-3">
                  {local.photos.map((url, i) => (
                    <div
                      key={i}
                      draggable
                      onDragStart={() => setDragIdx(i)}
                      onDragOver={(e) => onDragOver(e, i)}
                      onDragEnd={() => setDragIdx(null)}
                      className={`relative aspect-square rounded-xl overflow-hidden border-2 group cursor-move transition-all ${dragIdx === i ? "border-indigo-500 opacity-50" : "border-slate-800 hover:border-slate-600"}`}
                    >
                      <Image
                        src={url + IMG_SUFFIX}
                        alt=""
                        fill
                        className="object-cover"
                        unoptimized
                      />
                      <button
                        onClick={() => removePhoto(i)}
                        className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={12} />
                      </button>
                      <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/60 text-white text-[10px] rounded">
                        {i + 1}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-center text-slate-500 border border-dashed border-slate-700 rounded-lg">
                  Нет фото
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
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
