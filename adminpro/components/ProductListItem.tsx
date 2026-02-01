import React from 'react';
import { Product } from '../types';
import { MoreHorizontal } from 'lucide-react';

interface ProductListItemProps {
  product: Product;
}

const ProductListItem: React.FC<ProductListItemProps> = ({ product }) => {
  return (
    <div className="bg-slate-800 border-b border-slate-700 last:border-0 hover:bg-slate-700/50 transition-colors group">
      <div className="p-4 grid grid-cols-12 gap-4 items-center">
        
        {/* Image & Name */}
        <div className="col-span-12 sm:col-span-6 flex items-center gap-4">
          <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-slate-600 shrink-0">
            <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
          </div>
          <div>
            <h4 className="font-semibold text-slate-200 text-sm">{product.name}</h4>
            <div className="text-xs text-slate-500">{product.brand}</div>
          </div>
        </div>

        {/* Category */}
        <div className="col-span-6 sm:col-span-4">
          <div className="text-sm text-slate-300">{product.category}</div>
          <div className="text-xs text-slate-500">{product.subcategory}</div>
        </div>

        {/* Price & Actions */}
        <div className="col-span-6 sm:col-span-2 flex items-center justify-between sm:justify-end gap-4">
          <div className="text-right">
            <div className="font-medium text-slate-200 text-sm">
              {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(product.price)}
            </div>
          </div>
          
          <div className="flex items-center gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
            <button className="p-2 text-slate-400 hover:text-white hover:bg-slate-600 rounded-lg transition-colors">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

export default ProductListItem;