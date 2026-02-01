export interface Product {
  id: string;
  name: string;
  brand: string;
  category: string;
  subcategory: string;
  price: number;
  image: string;
  description?: string;
}

export type ViewMode = 'grid' | 'list';

export interface FilterState {
  search: string;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
}