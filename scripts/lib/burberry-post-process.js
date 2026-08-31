const crypto = require('crypto');
const MIN_REPOST_POSITION_GAP = 100;

function externalId(product) {
  return String(product?.external_id || '').trim();
}

function sourcePosition(product) {
  const value = Number(product?.source_position);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function normalizedDescription(product) {
  return String(product?.description || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedPhotoUrls(product) {
  const values = Array.isArray(product?.photos) ? product.photos : [];
  return [...new Set(values.map((value) => String(value || '').trim()
    .split('?', 1)[0]
    .split('#', 1)[0]
    .replace(/\/+$/, ''))
    .filter(Boolean))];
}

function extractedModelCode(product) {
  const match = String(product?.description || '').normalize('NFKC')
    .match(/(?:model|型号|款号|货号|编号)\s*[:：#]?\s*([a-z0-9][a-z0-9._/-]{4,15})/i);
  if (!match) return '';
  const code = match[1].replace(/[^a-z0-9]/gi, '').toUpperCase();
  return /\d/.test(code) ? code : '';
}

function photoDirectory(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^(.*\/\d{8})\//);
    return match ? `${url.hostname.toLowerCase()}${match[1].toLowerCase()}` : '';
  } catch {
    return '';
  }
}

function modelCode(product) {
  return String(product?.attributes?.model_code || '').trim().toUpperCase() || extractedModelCode(product);
}

function exactGalleryKey(product) {
  const photos = normalizedPhotoUrls(product).sort();
  if (photos.length === 0) return '';
  return JSON.stringify(photos);
}

function burberryDuplicatePair(left, right) {
  const leftPhotos = normalizedPhotoUrls(left);
  const rightPhotos = normalizedPhotoUrls(right);
  if (leftPhotos.length === 0 || rightPhotos.length === 0) return false;
  if (exactGalleryKey(left) === exactGalleryKey(right)) return true;

  const leftModel = modelCode(left);
  if (!leftModel || leftModel !== modelCode(right)) return false;
  if (normalizedDescription(left) !== normalizedDescription(right)) return false;

  const rightPhotoSet = new Set(rightPhotos);
  const overlap = leftPhotos.filter((photo) => rightPhotoSet.has(photo));
  if (overlap.length >= 2) return true;
  if (overlap.length !== 1) return false;
  if (Math.abs(sourcePosition(left) - sourcePosition(right)) < MIN_REPOST_POSITION_GAP) return false;

  const leftDirectories = new Set(leftPhotos.map(photoDirectory).filter(Boolean));
  return rightPhotos.some((photo) => leftDirectories.has(photoDirectory(photo)));
}

function cloneProduct(product) {
  const attributes = product?.attributes && typeof product.attributes === 'object' && !Array.isArray(product.attributes)
    ? { ...product.attributes }
    : {};
  const code = modelCode({ ...product, attributes });
  if (code) attributes.model_code = code;
  return {
    ...product,
    attributes,
    photos: Array.isArray(product?.photos) ? [...product.photos] : [],
  };
}

function restoreProtectedProducts(processedProducts, sourceProducts, protectedExternalIds) {
  const result = (Array.isArray(processedProducts) ? processedProducts : []).map(cloneProduct);
  const present = new Set(result.map(externalId).filter(Boolean));
  for (const product of Array.isArray(sourceProducts) ? sourceProducts : []) {
    const id = externalId(product);
    if (!id || present.has(id) || !protectedExternalIds.has(id)) continue;
    result.push(cloneProduct(product));
    present.add(id);
  }
  return result.sort((left, right) => sourcePosition(left) - sourcePosition(right));
}

function mergeDuplicateFields(keeper, duplicate) {
  const duplicateAttributes = duplicate?.attributes && typeof duplicate.attributes === 'object'
    ? duplicate.attributes
    : {};
  for (const [key, value] of Object.entries(duplicateAttributes)) {
    if (!(key in keeper.attributes) && value !== null && value !== '' && value !== undefined) {
      keeper.attributes[key] = value;
    }
  }
}

function deduplicateBurberryProductsOnce(products, protectedExternalIds = new Set()) {
  const items = (Array.isArray(products) ? products : []).map(cloneProduct);
  const protectedItems = items.filter((product) => protectedExternalIds.has(externalId(product)));
  const protectedReposts = new Set();
  for (const item of items) {
    if (protectedItems.includes(item)) continue;
    const existing = protectedItems.find((candidate) => burberryDuplicatePair(candidate, item));
    if (!existing) continue;
    mergeDuplicateFields(existing, item);
    protectedReposts.add(item);
  }
  // Require duplicate evidence against every member of a group. This avoids
  // transitive A-B/B-C merges where A and C are distinct color galleries.
  const components = [];
  for (const item of items) {
    if (protectedReposts.has(item)) continue;
    const component = components.find((members) => members.every((member) => burberryDuplicatePair(member, item)));
    if (component) component.push(item);
    else components.push([item]);
  }

  const result = [];
  for (const members of components.values()) {
    const protectedMembers = members.filter((product) => protectedExternalIds.has(externalId(product)));
    if (protectedMembers.length > 0) {
      const primary = [...protectedMembers].sort((left, right) => sourcePosition(left) - sourcePosition(right))[0];
      for (const duplicate of members) {
        if (!protectedExternalIds.has(externalId(duplicate))) mergeDuplicateFields(primary, duplicate);
      }
      result.push(...protectedMembers);
      continue;
    }

    const keeper = [...members].sort((left, right) => sourcePosition(left) - sourcePosition(right))[0];
    for (const duplicate of members) {
      if (duplicate !== keeper) mergeDuplicateFields(keeper, duplicate);
    }
    result.push(keeper);
  }

  return result.sort((left, right) => sourcePosition(left) - sourcePosition(right));
}

function deduplicateBurberryProducts(products, protectedExternalIds = new Set()) {
  let current = Array.isArray(products) ? products : [];
  for (let pass = 0; pass <= current.length; pass += 1) {
    const next = deduplicateBurberryProductsOnce(current, protectedExternalIds);
    if (next.length === current.length) return next;
    current = next;
  }
  return current;
}

function assignBurberryVariantGroups(products) {
  const items = products.map(cloneProduct);
  const groups = new Map();
  for (const product of items) {
    const code = modelCode(product);
    if (!code) continue;
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(product);
  }

  for (const product of items) {
    delete product.variant_group_key;
    delete product.variant_group_name;
  }
  for (const [code, members] of groups) {
    if (members.length < 2) continue;
    const key = crypto.createHash('md5').update(`burberry:${code}`).digest('hex');
    for (const product of members) {
      product.variant_group_key = key;
      product.variant_group_name = `Burberry ${code}`;
    }
  }
  return items;
}

function finalizeBurberryPostProcess(products, protectedExternalIds = new Set()) {
  return assignBurberryVariantGroups(deduplicateBurberryProducts(products, protectedExternalIds));
}

module.exports = {
  burberryDuplicatePair,
  deduplicateBurberryProducts,
  finalizeBurberryPostProcess,
  restoreProtectedProducts,
};
