import React from 'react';
import { FilterState } from '../types';
import { BRANDS, CATEGORIES } from '../constants';
import { X, Filter } from 'lucide-react';

interface FiltersProps {
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  isOpen: boolean;
  onClose: () => void;
  count: number;
}

const Filters: React.FC<FiltersProps> = ({ filters, setFilters, isOpen, onClose, count }) => {
  
  const handleReset = () => {
    setFilters({
      search: '',
      brand: null,
      category: null,
      subcategory: null
    });
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters(prev => ({
      ...prev,
      category: e.target.value || null,
      subcategory: null // Reset subcategory when category changes
    }));
  };

  const availableSubcategories = filters.category 
    ? (CATEGORIES as any)[filters.category] || []
    : [];

  return (
    <>
      {/* Mobile Overlay */}
      <div 
        className={`fixed inset-0 bg-black/70 z-40 transition-opacity lg:hidden ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Sidebar Container */}
      <aside className={`
        fixed lg:sticky top-0 left-0 h-screen w-72 bg-slate-800 border-r border-slate-700 z-50 overflow-y-auto transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <Filter className="w-5 h-5 text-indigo-400" />
              Фильтры
            </h2>
            <button onClick={onClose} className="lg:hidden p-1 text-slate-400 hover:text-slate-200">
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="space-y-6">
            
            {/* Category Filter */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Категория</label>
              <select
                value={filters.category || ''}
                onChange={handleCategoryChange}
                className="w-full rounded-lg border-slate-600 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 py-2.5 px-3 bg-slate-700 text-slate-200 border"
              >
                <option value="">Все категории</option>
                {Object.keys(CATEGORIES).map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            {/* Subcategory Filter (Conditional) */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Подкатегория</label>
              <select
                value={filters.subcategory || ''}
                onChange={(e) => setFilters(prev => ({ ...prev, subcategory: e.target.value || null }))}
                disabled={!filters.category}
                className="w-full rounded-lg border-slate-600 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 py-2.5 px-3 bg-slate-700 text-slate-200 border disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">Все подкатегории</option>
                {availableSubcategories.map((sub: string) => (
                  <option key={sub} value={sub}>{sub}</option>
                ))}
              </select>
            </div>

            {/* Brand Filter */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Бренд</label>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                {BRANDS.map(brand => (
                  <label key={brand} className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="radio" 
                      name="brand"
                      checked={filters.brand === brand}
                      onChange={() => setFilters(prev => ({ ...prev, brand: prev.brand === brand ? null : brand }))}
                      className="w-4 h-4 text-indigo-500 border-slate-500 bg-slate-700 focus:ring-indigo-500 focus:ring-offset-slate-800 rounded-full"
                    />
                    <span className="text-sm text-slate-400 group-hover:text-slate-200 transition-colors">{brand}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-700">
            <div className="flex items-center justify-between text-sm text-slate-400 mb-4">
              <span>Найдено:</span>
              <span className="font-semibold text-slate-200">{count} товаров</span>
            </div>
            <button
              onClick={handleReset}
              className="w-full py-2 px-4 bg-slate-700 border border-slate-600 text-slate-300 rounded-lg hover:bg-slate-600 hover:text-white transition-colors text-sm font-medium"
            >
              Сбросить фильтры
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Filters;