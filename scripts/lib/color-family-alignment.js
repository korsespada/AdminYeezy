// Цветовая семья — один товар в разных цветах. Внутри семьи различаются только
// цвет и производное от него (имя, описание, фото, alt, slug, наличие); всё
// остальное обязано совпадать. Модуль чистый: его используют AI-конвейер
// (выравнивание после прохода и одобрение) и публикация (проверка перед Rails).

const FAMILY_ERROR_PREFIX = 'Цветовая семья: ';

const CLASSIFICATION_FIELDS = [
  { key: 'brand', label: 'бренд', read: (product) => text(product.brand) },
  { key: 'gender', label: 'пол', read: (product) => text(product.gender) },
  {
    key: 'category',
    label: 'категория и подкатегория',
    read: (product) => (text(product.category) ? { category: text(product.category), subcategory: text(product.subcategory) } : ''),
  },
];

// Модель и материал ИИ описывает по-разному в каждой карточке: в семье берётся
// общее значение, расхождение не блокирует.
const CONSENSUS_ATTRIBUTES = [
  { key: 'model_name', label: 'модель' },
  { key: 'materials', label: 'материалы' },
];

// Физические признаки: пустое значение дополняется, но два разных непустых
// значения означают, что в семье разные изделия.
const PHYSICAL_ATTRIBUTES = [
  { key: 'hardware_color', label: 'цвет фурнитуры' },
  { key: 'dimensions', label: 'габариты' },
  { key: 'bag_width_cm', label: 'ширина сумки' },
  { key: 'bag_height_cm', label: 'высота сумки' },
];

function text(value) {
  return String(value ?? '').trim();
}

function attributesOf(product) {
  let value = product?.attributes;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizedText(value) {
  return text(value).normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return !value.trim();
  if (typeof value === 'number') return !Number.isFinite(value) || value === 0;
  if (Array.isArray(value)) return value.every(isEmptyValue);
  if (typeof value === 'object') return Object.values(value).every(isEmptyValue);
  return false;
}

/** Ключ сравнения: регистр, ё и порядок элементов списка не различают значения. */
function valueKey(value) {
  if (isEmptyValue(value)) return '';
  if (typeof value === 'string') return normalizedText(value);
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value) && value.every((item) => item === null || typeof item !== 'object')) {
    return [...new Set(value.map(normalizedText).filter(Boolean))].sort().join('|');
  }
  return stableJson(value);
}

function sameValue(left, right) {
  return valueKey(left) === valueKey(right);
}

function numberOrInfinity(value) {
  const number = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(number) ? number : Number.POSITIVE_INFINITY;
}

/** Якорь семьи — первый цвет альбома, затем исходная позиция. */
function anchorOrder(members) {
  return [...members].sort((left, right) => (
    numberOrInfinity(attributesOf(left).album_colour_index) - numberOrInfinity(attributesOf(right).album_colour_index)
    || numberOrInfinity(left.source_position) - numberOrInfinity(right.source_position)
    || numberOrInfinity(left.id) - numberOrInfinity(right.id)
  ));
}

function productRef(product) {
  return text(product.external_id) || `#${text(product.id)}`;
}

/**
 * Группирует непустые значения. Побеждает самая частая группа; при равенстве —
 * группа, в которой раньше встречается якорь (группы создаются в порядке якоря).
 */
function consensus(ordered, read) {
  const groups = new Map();
  for (const product of ordered) {
    const value = read(product);
    if (isEmptyValue(value)) continue;
    const key = valueKey(value);
    const group = groups.get(key) || { key, value, products: [] };
    group.products.push(product);
    groups.set(key, group);
  }
  let winner = null;
  for (const group of groups.values()) {
    if (!winner || group.products.length > winner.products.length) winner = group;
  }
  return { winner, groups: [...groups.values()] };
}

function groupsDescription(groups) {
  return groups.map((group) => group.products.map(productRef).join(', ')).join(' / ');
}

function issue(field, label, groups, products) {
  return {
    field,
    message: `${label} различается (${groupsDescription(groups)})`,
    productIds: products.map((product) => product.id),
  };
}

function colorKey(product) {
  const colors = attributesOf(product).colors;
  const color = Array.isArray(colors) ? colors[0] : colors;
  return normalizedText(color).replace(/[^a-zа-я0-9 ]+/g, ' ').split(' ').filter(Boolean).sort().join(' ');
}

function colorIssues(ordered) {
  const missing = ordered.filter((product) => !colorKey(product));
  const byColor = new Map();
  for (const product of ordered) {
    const key = colorKey(product);
    if (key) byColor.set(key, [...(byColor.get(key) || []), product]);
  }
  const duplicates = [...byColor.values()].filter((products) => products.length > 1);
  return [
    ...(missing.length ? [{
      field: 'colors',
      message: `не указан цвет (${missing.map(productRef).join(', ')})`,
      productIds: missing.map((product) => product.id),
    }] : []),
    ...duplicates.map((products) => ({
      field: 'colors',
      message: `одинаковый цвет «${text(attributesOf(products[0]).colors?.[0] ?? attributesOf(products[0]).colors)}» (${products.map(productRef).join(', ')})`,
      productIds: products.map((product) => product.id),
    })),
  ];
}

function measurementsOf(product) {
  let value = attributesOf(product).measurements;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function hasMeasurementTable(value) {
  if (!value) return false;
  if (Array.isArray(value.tabs)) return value.tabs.some((tab) => Array.isArray(tab?.rows) && tab.rows.length > 0);
  return Array.isArray(value.rows) && value.rows.length > 0;
}

function chartSourceIds(product) {
  const attributes = attributesOf(product);
  return new Set([
    ...(Array.isArray(attributes.size_chart_source_ids) ? attributes.size_chart_source_ids : []),
    attributes.size_chart_source_id,
  ].map(text).filter(Boolean));
}

/** Все товары с таблицей ссылаются хотя бы на один общий исходный альбом сетки. */
function shareChartSource(products) {
  const [first, ...rest] = products.map(chartSourceIds);
  if (!first || first.size === 0) return false;
  return [...first].some((id) => rest.every((ids) => ids.has(id)));
}

function priceCandidates(ordered) {
  const priced = ordered.filter((product) => Number(product.price) > 0);
  const manual = priced.filter((product) => product.price_source === 'manual');
  return manual.length > 0 ? { products: manual, manual: true } : { products: priced, manual: false };
}

/**
 * Выравнивает семью после AI-прохода: общие поля берутся по большинству
 * (при равенстве — по якорю), размерная сетка и размерный ряд переносятся на
 * все цвета. Возвращает изменения и конфликты, которые нельзя решить автоматически.
 */
function alignColorFamily(members) {
  const ordered = anchorOrder(members);
  const next = new Map(ordered.map((product) => [product.id, {
    product,
    fields: {},
    attributes: { ...attributesOf(product) },
  }]));
  const issues = [...colorIssues(ordered)];

  for (const field of CLASSIFICATION_FIELDS) {
    const { winner } = consensus(ordered, field.read);
    if (!winner) continue;
    for (const product of ordered) {
      if (sameValue(field.read(product), winner.value)) continue;
      const target = next.get(product.id).fields;
      if (field.key === 'category') Object.assign(target, winner.value);
      else target[field.key] = winner.value;
    }
  }

  const prices = priceCandidates(ordered);
  const priceGroups = consensus(prices.products, (product) => Number(product.price));
  if (prices.manual && priceGroups.groups.length > 1) {
    issues.push(issue('price', 'ручная цена', priceGroups.groups, prices.products));
  } else if (priceGroups.winner) {
    const source = priceGroups.winner.products[0];
    for (const product of ordered) {
      if (Number(product.price) === Number(source.price)) continue;
      Object.assign(next.get(product.id).fields, {
        price: Number(source.price),
        price_source: source.price_source || 'legacy',
      });
    }
  }

  for (const attribute of CONSENSUS_ATTRIBUTES) {
    const { winner } = consensus(ordered, (product) => attributesOf(product)[attribute.key]);
    if (!winner) continue;
    for (const product of ordered) {
      if (!sameValue(attributesOf(product)[attribute.key], winner.value)) {
        next.get(product.id).attributes[attribute.key] = winner.value;
      }
    }
  }

  for (const attribute of PHYSICAL_ATTRIBUTES) {
    const { winner, groups } = consensus(ordered, (product) => attributesOf(product)[attribute.key]);
    if (groups.length > 1) {
      issues.push(issue(attribute.key, attribute.label, groups, groups.flatMap((group) => group.products)));
      continue;
    }
    if (!winner) continue;
    for (const product of ordered) {
      if (isEmptyValue(attributesOf(product)[attribute.key])) next.get(product.id).attributes[attribute.key] = winner.value;
    }
  }

  const sizing = alignSizing(ordered);
  issues.push(...sizing.issues);
  for (const [id, patch] of sizing.patches) Object.assign(next.get(id).attributes, patch);

  const updates = [];
  for (const { product, fields, attributes } of next.values()) {
    const changedAttributes = stableJson(attributes) !== stableJson(attributesOf(product));
    if (Object.keys(fields).length === 0 && !changedAttributes) continue;
    updates.push({ id: product.id, fields, ...(changedAttributes ? { attributes } : {}) });
  }
  return { updates, issues };
}

function alignSizing(ordered) {
  const patches = new Map();
  const issues = [];
  const tables = consensus(ordered, (product) => {
    const measurements = measurementsOf(product);
    return hasMeasurementTable(measurements) ? measurements : null;
  });
  const recommendations = consensus(ordered, (product) => attributesOf(product).size_recommendation);

  if (tables.groups.length > 1 && !shareChartSource(tables.groups.flatMap((group) => group.products))) {
    // Разные сетки (например, чарт только от брюк комплекта) не угадываются.
    issues.push(issue('measurements', 'размерная сетка', tables.groups, tables.groups.flatMap((group) => group.products)));
    return { patches, issues };
  }

  let source = null;
  let sizes = null;
  if (tables.winner) {
    source = tables.winner.products[0];
    sizes = attributesOf(source).sizes;
  } else {
    const sizeGroups = consensus(ordered, (product) => attributesOf(product).sizes);
    sizes = sizeGroups.winner ? sizeGroups.winner.value : null;
  }
  const recommendation = source && !isEmptyValue(attributesOf(source).size_recommendation)
    ? attributesOf(source).size_recommendation
    : recommendations.groups.length === 1 ? recommendations.winner.value : null;

  for (const product of ordered) {
    const attributes = attributesOf(product);
    const patch = {};
    if (source && !sameValue(measurementsOf(product), measurementsOf(source))) patch.measurements = measurementsOf(source);
    if (!isEmptyValue(sizes) && !sameValue(attributes.sizes, sizes)) patch.sizes = sizes;
    if (!isEmptyValue(recommendation) && !sameValue(attributes.size_recommendation, recommendation)) {
      patch.size_recommendation = recommendation;
    }
    if (Object.keys(patch).length > 0) patches.set(product.id, patch);
  }
  return { patches, issues };
}

function strictGroups(ordered, read) {
  const groups = new Map();
  for (const product of ordered) {
    const value = read(product);
    const key = valueKey(value);
    const group = groups.get(key) || { key, value, products: [] };
    group.products.push(product);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Строгая проверка без исправлений: одобрение предложения ИИ и публикация.
 * `sizing: false` пропускает размерный ряд, если его затем выровняет сервер;
 * `colors: false` — цвета, если их уже проверил вызывающий код.
 */
function colorFamilyIssues(members, options = {}) {
  const ordered = anchorOrder(members);
  if (ordered.length < 2) return [];
  const issues = options.colors === false ? [] : colorIssues(ordered);

  for (const field of CLASSIFICATION_FIELDS) {
    const groups = strictGroups(ordered, field.read);
    if (groups.length > 1) issues.push(issue(field.key, field.label, groups, ordered));
  }
  const priceGroups = strictGroups(ordered, (product) => Number(product.price) || 0);
  if (priceGroups.length > 1) issues.push(issue('price', 'цена', priceGroups, ordered));

  for (const attribute of PHYSICAL_ATTRIBUTES) {
    const groups = consensus(ordered, (product) => attributesOf(product)[attribute.key]).groups;
    if (groups.length > 1) issues.push(issue(attribute.key, attribute.label, groups, ordered));
  }

  if (options.sizing !== false) {
    const tableGroups = strictGroups(ordered, (product) => {
      const measurements = measurementsOf(product);
      return hasMeasurementTable(measurements) ? measurements : null;
    });
    if (tableGroups.length > 1) issues.push(issue('measurements', 'размерная сетка', tableGroups, ordered));
    const sizeGroups = strictGroups(ordered, (product) => attributesOf(product).sizes);
    if (sizeGroups.length > 1) issues.push(issue('sizes', 'размерный ряд', sizeGroups, ordered));
  }
  return issues;
}

function familyLabel(members) {
  const named = members.find((product) => text(product.variant_group_name));
  return named ? text(named.variant_group_name) : text(members[0]?.variant_group_key).slice(0, 12);
}

/** Группирует товары по variant_group_key и возвращает конфликты семей из двух и более товаров. */
function batchColorFamilyIssues(products, options = {}) {
  const families = new Map();
  for (const product of products) {
    const key = text(product.variant_group_key);
    if (key) families.set(key, [...(families.get(key) || []), product]);
  }
  return [...families.values()]
    .filter((members) => members.length > 1)
    .flatMap((members) => colorFamilyIssues(members, options).map((entry) => ({
      ...entry,
      family: familyLabel(members),
    })));
}

module.exports = {
  FAMILY_ERROR_PREFIX,
  alignColorFamily,
  batchColorFamilyIssues,
  colorFamilyIssues,
  familyLabel,
};
