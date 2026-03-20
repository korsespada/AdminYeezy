'use server'

import { revalidatePath } from 'next/cache'
import { query, redis, elastic } from '@/lib/db'
import type { ActionResponse } from '@/lib/types'

/**
 * Вспомогательная функция для очистки кеша и обновления Elastic
 */
async function syncExternalServices(productId: string, action: 'update' | 'delete', data?: any) {
  try {
    // 1. Очистка Redis (обычно в магазине кешируются списки и сам товар)
    await redis.del(`product:${productId}`);
    await redis.del('catalog:all'); // Очищаем общий кеш каталога
    console.log(`[Redis] Cache invalidated for ${productId}`);

    // 2. Обновление Elasticsearch
    const indexName = 'products';
    if (action === 'delete') {
      await elastic.delete({
        index: indexName,
        id: productId,
      }).catch(() => null);
    } else if (data) {
      await elastic.index({
        index: indexName,
        id: productId,
        document: {
          id: productId,
          name: data.name,
          description: data.description,
          price: data.price,
          brand: data.brand,
          category: data.category,
          subcategory: data.subcategory,
          gender: data.gender,
          status: data.status,
          updated_at: new Date(),
        },
      });
    }
    console.log(`[Elastic] Index ${action === 'delete' ? 'deleted' : 'updated'} for ${productId}`);
  } catch (err: any) {
    console.warn('Sync error (Postgres saved, but Redis/Elastic failed):', err.message);
  }
}

/**
 * Создание товара в Postgres
 */
export async function createProductAction(formData: FormData): Promise<ActionResponse> {
  try {
    const id = formData.get('productId') as string; // Используем productId как основной ID
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;
    const price = parseFloat(formData.get('price') as string || '0');
    const status = formData.get('status') as string || 'active';
    const brands = formData.getAll('brand') as string[];
    const category = formData.get('category') as string;
    const subcategory = formData.get('subcategory') as string;
    const gender = formData.get('gender') as string;
    const existingPhotosStr = formData.get('existingPhotos') as string;
    const photos = existingPhotosStr ? JSON.parse(existingPhotosStr) : [];

    // SQL запрос для вставки
    const sql = `
      INSERT INTO products (id, name, description, price, status, brand, category, subcategory, gender, photos, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING id
    `;
    
    // В Postgres массив брендов передаем как текст формата {val1,val2} или JSONB
    const res = await query(sql, [
      id, name, description, price, status, 
      brands, // node-postgres сам сконвертирует массив в формат Postgres
      category, subcategory, gender, 
      JSON.stringify(photos)
    ]);

    await syncExternalServices(id, 'update', { name, description, price, brand: brands, category, subcategory, gender, status });
    
    return { success: true };
  } catch (error: any) {
    console.error('Create product error:', error);
    return { success: false, error: error.message || 'Failed to create product' };
  }
}

/**
 * Обновление товара
 */
export async function updateProductAction(id: string, formData: FormData): Promise<ActionResponse> {
  try {
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;
    const price = parseFloat(formData.get('price') as string || '0');
    const status = formData.get('status') as string || 'active';
    const brands = formData.getAll('brand') as string[];
    const category = formData.get('category') as string;
    const subcategory = formData.get('subcategory') as string;
    const gender = formData.get('gender') as string;
    const existingPhotosStr = formData.get('existingPhotos') as string;
    const photos = existingPhotosStr ? JSON.parse(existingPhotosStr) : [];

    const sql = `
      UPDATE products 
      SET name = $1, description = $2, price = $3, status = $4, brand = $5, 
          category = $6, subcategory = $7, gender = $8, photos = $9, updated_at = NOW()
      WHERE id = $10
    `;
    
    await query(sql, [
      name, description, price, status, brands, 
      category, subcategory, gender, 
      JSON.stringify(photos), 
      id
    ]);

    await syncExternalServices(id, 'update', { name, description, price, brand: brands, category, subcategory, gender, status });

    return { success: true };
  } catch (error: any) {
    console.error('Update product error:', error);
    return { success: false, error: error.message || 'Failed to update product' };
  }
}

/**
 * Удаление товара
 */
export async function deleteProductAction(id: string): Promise<ActionResponse> {
  try {
    await query('DELETE FROM products WHERE id = $1', [id]);
    await syncExternalServices(id, 'delete');
    
    return { success: true };
  } catch (error: any) {
    console.error('Delete product error:', error);
    return { success: false, error: 'Failed to delete product' };
  }
}
