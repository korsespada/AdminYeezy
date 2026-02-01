import { Product } from './types';

export const BRANDS = ['Apple', 'Samsung', 'Nike', 'Adidas', 'Sony', 'LG', 'Herman Miller', 'IKEA'];
export const CATEGORIES = {
  'Электроника': ['Смартфоны', 'Ноутбуки', 'Аксессуары'],
  'Одежда': ['Мужская', 'Женская', 'Спортивная'],
  'Мебель': ['Офисная', 'Домашняя', 'Декор']
};

const BASE_PRODUCTS: Omit<Product, 'id'>[] = [
  {
    name: 'iPhone 15 Pro Max',
    brand: 'Apple',
    category: 'Электроника',
    subcategory: 'Смартфоны',
    price: 119990,
    image: 'https://picsum.photos/400/400?random=1',
    description: 'Флагманский смартфон от Apple с титановым корпусом.'
  },
  {
    name: 'Galaxy S24 Ultra',
    brand: 'Samsung',
    category: 'Электроника',
    subcategory: 'Смартфоны',
    price: 109990,
    image: 'https://picsum.photos/400/400?random=2',
  },
  {
    name: 'Air Max 270',
    brand: 'Nike',
    category: 'Одежда',
    subcategory: 'Спортивная',
    price: 15990,
    image: 'https://picsum.photos/400/400?random=3',
  },
  {
    name: 'Aeron Chair',
    brand: 'Herman Miller',
    category: 'Мебель',
    subcategory: 'Офисная',
    price: 145000,
    image: 'https://picsum.photos/400/400?random=4',
  },
  {
    name: 'WH-1000XM5',
    brand: 'Sony',
    category: 'Электроника',
    subcategory: 'Аксессуары',
    price: 35990,
    image: 'https://picsum.photos/400/400?random=5',
  },
  {
    name: 'MacBook Pro 16',
    brand: 'Apple',
    category: 'Электроника',
    subcategory: 'Ноутбуки',
    price: 249990,
    image: 'https://picsum.photos/400/400?random=6',
  },
  {
    name: 'Ultraboost Light',
    brand: 'Adidas',
    category: 'Одежда',
    subcategory: 'Спортивная',
    price: 18990,
    image: 'https://picsum.photos/400/400?random=7',
  },
  {
    name: 'Poäng',
    brand: 'IKEA',
    category: 'Мебель',
    subcategory: 'Домашняя',
    price: 8990,
    image: 'https://picsum.photos/400/400?random=8',
  },
  {
    name: 'OLED C3 TV',
    brand: 'LG',
    category: 'Электроника',
    subcategory: 'Аксессуары',
    price: 129990,
    image: 'https://picsum.photos/400/400?random=9',
  }
];

// Generate 200 items for pagination testing
export const MOCK_PRODUCTS: Product[] = Array.from({ length: 200 }).map((_, index) => {
  const base = BASE_PRODUCTS[index % BASE_PRODUCTS.length];
  // Slightly vary the price to make it look realistic
  const variation = Math.floor(Math.random() * 5000) - 2500;
  
  return {
    ...base,
    id: (index + 1).toString(),
    name: `${base.name} ${index > 8 ? `(Ver. ${Math.floor(index / 9) + 1})` : ''}`,
    price: Math.max(1000, base.price + variation),
    image: `https://picsum.photos/400/400?random=${index + 1}`
  };
});