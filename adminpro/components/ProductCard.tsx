import React from 'react';
import { Product } from '../types';
import { MoreHorizontal } from 'lucide-react';

interface ProductCardProps {
  product: Product;
}

const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden hover:shadow-xl hover:shadow-black/20 hover:border-slate-600 transition-all duration-300 group flex flex-col h-full">
      <div className="relative aspect-square overflow-hidden bg-slate-900">
        <img 
          src={product.image} 
          alt={product.name} 
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-90 group-hover:opacity-100"
        />
        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <button className="p-2 bg-slate-900/80 backdrop-blur-sm rounded-full shadow-lg hover:bg-indigo-600 text-slate-300 hover:text-white transition-colors">
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="p-5 flex-1 flex flex-col">
        <div className="mb-2">
           <span className="text-xs font-medium text-indigo-400 uppercase tracking-wider">{product.brand}</span>
           <div className="text-xs text-slate-500 mt-0.5">{product.category} &bull; {product.subcategory}</div>
        </div>
        
        <h3 className="text-base font-bold text-slate-100 mb-2 leading-tight">{product.name}</h3>
        
        <div className="flex-1">
          {product.description && (
            <p className="text-sm text-slate-400 mb-4 line-clamp-2">{product.description}</p>
          )}
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-slate-700 mt-auto">
          <div className="font-bold text-lg text-slate-200">
            {new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(product.price)}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;