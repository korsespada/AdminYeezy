import React, { useState, useMemo, useEffect } from 'react';
import { LayoutGrid, List, Search, Plus, Menu, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import Filters from './components/Filters';
import ProductCard from './components/ProductCard';
import ProductListItem from './components/ProductListItem';
import { FilterState, ViewMode, Product } from './types';
import { MOCK_PRODUCTS } from './constants';

const ITEMS_PER_PAGE = 40;

const App: React.FC = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [currentPage, setCurrentPage] = useState(1);
  
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    brand: null,
    category: null,
    subcategory: null,
  });

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  const filteredProducts = useMemo(() => {
    return MOCK_PRODUCTS.filter((product: Product) => {
      // Search
      const matchesSearch = product.name.toLowerCase().includes(filters.search.toLowerCase()) || 
                            product.brand.toLowerCase().includes(filters.search.toLowerCase());
      
      // Filters
      const matchesBrand = filters.brand ? product.brand === filters.brand : true;
      const matchesCategory = filters.category ? product.category === filters.category : true;
      const matchesSubcategory = filters.subcategory ? product.subcategory === filters.subcategory : true;

      return matchesSearch && matchesBrand && matchesCategory && matchesSubcategory;
    });
  }, [filters]);

  const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
  
  const currentProducts = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredProducts.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredProducts, currentPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col lg:flex-row font-sans text-slate-200">
      
      {/* Sidebar Filters */}
      <Filters 
        filters={filters} 
        setFilters={setFilters} 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)} 
        count={filteredProducts.length}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        
        {/* Header */}
        <header className="bg-slate-800 border-b border-slate-700 py-3 px-6 sticky top-0 z-30 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-2 text-slate-400 hover:bg-slate-700 hover:text-white rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="relative max-w-md w-full hidden sm:block">
              <input
                type="text"
                placeholder="Поиск товаров..."
                value={filters.search}
                onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                className="w-80 pl-10 pr-4 py-2 bg-slate-700 border-none rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:bg-slate-700 transition-all"
              />
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="h-8 w-px bg-slate-700 hidden sm:block"></div>
            <button className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-full hover:bg-slate-700 transition-colors">
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-xs border border-indigo-500/30">
                AD
              </div>
              <span className="text-sm font-medium text-slate-300 hidden sm:block">Admin</span>
              <ChevronDown className="w-4 h-4 text-slate-500 hidden sm:block" />
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          <div className="max-w-7xl mx-auto">
            
            {/* Page Header & Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
              <div>
                <h1 className="text-2xl font-bold text-slate-100">Товары</h1>
                <p className="text-slate-400 text-sm mt-1">Управление каталогом</p>
              </div>

              <div className="flex items-center gap-3">
                 {/* Mobile Search - Visible only on small screens */}
                 <div className="sm:hidden w-full">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Поиск..."
                      value={filters.search}
                      onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                      className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-200"
                    />
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  </div>
                 </div>

                <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700 shadow-sm shrink-0">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`p-2 rounded-md transition-all ${viewMode === 'grid' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    <List className="w-4 h-4" />
                  </button>
                </div>

                <button className="hidden sm:flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm transition-all active:scale-95 shrink-0">
                  <Plus className="w-4 h-4" />
                  <span>Добавить</span>
                </button>
                
                {/* Mobile Add Button */}
                <button className="sm:hidden flex items-center justify-center w-10 h-10 bg-indigo-600 text-white rounded-lg shadow-sm shrink-0">
                   <Plus className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content Display */}
            {filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mb-4">
                  <Search className="w-10 h-10 text-slate-600" />
                </div>
                <h3 className="text-lg font-medium text-slate-200">Ничего не найдено</h3>
                <p className="text-slate-500 max-w-xs mx-auto mt-1">Попробуйте изменить параметры поиска или сбросить фильтры.</p>
                <button 
                  onClick={() => setFilters({ search: '', brand: null, category: null, subcategory: null })}
                  className="mt-4 text-indigo-400 hover:text-indigo-300 font-medium"
                >
                  Сбросить все фильтры
                </button>
              </div>
            ) : (
              <>
                {viewMode === 'grid' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8">
                    {currentProducts.map(product => (
                      <ProductCard key={product.id} product={product} />
                    ))}
                  </div>
                ) : (
                  <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-sm mb-8">
                    <div className="hidden sm:grid grid-cols-12 gap-4 p-4 border-b border-slate-700 bg-slate-800/50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <div className="col-span-6">Товар</div>
                      <div className="col-span-4">Категория</div>
                      <div className="col-span-2 text-right">Цена</div>
                    </div>
                    <div className="divide-y divide-slate-700">
                      {currentProducts.map(product => (
                        <ProductListItem key={product.id} product={product} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-slate-700 pt-6 pb-2">
                    <div className="text-sm text-slate-500">
                      Показано <span className="font-medium text-slate-200">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> - <span className="font-medium text-slate-200">{Math.min(currentPage * ITEMS_PER_PAGE, filteredProducts.length)}</span> из <span className="font-medium text-slate-200">{filteredProducts.length}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="p-2 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                          // Simple pagination logic: show all if pages < 7, otherwise just simplified for demo
                          <button
                            key={page}
                            onClick={() => handlePageChange(page)}
                            className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors
                              ${currentPage === page 
                                ? 'bg-indigo-600 text-white' 
                                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                              }
                            `}
                          >
                            {page}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className="p-2 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;