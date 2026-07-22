'use client'

import React, { useState } from 'react'
import { Save, Bot, Info, ShieldAlert, Cpu, Plus, X, Check } from 'lucide-react'
import { updateSettingAction } from '@/actions/settings'

interface AIRulesEditorProps {
  initialRules: string
  initialModels: string[]
  initialSelectedModel: string
  initialV2GroupingModel: string
  initialV2ProductModel: string
}

export default function AIRulesEditor({
  initialRules,
  initialModels,
  initialSelectedModel,
  initialV2GroupingModel,
  initialV2ProductModel,
}: AIRulesEditorProps) {
  const [rules, setRules] = useState(initialRules)
  const [models, setModels] = useState<string[]>(initialModels)
  const [selectedModel, setSelectedModel] = useState(initialSelectedModel)
  const [v2GroupingModel, setV2GroupingModel] = useState(initialV2GroupingModel)
  const [v2ProductModel, setV2ProductModel] = useState(initialV2ProductModel)
  const [newModel, setNewModel] = useState('')
  
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const handleSave = async () => {
    setIsSaving(true)
    setMessage(null)
    
    try {
        const p1 = updateSettingAction('general_ai_rules', rules)
        const p2 = updateSettingAction('available_ai_models', JSON.stringify(models))
        const p3 = updateSettingAction('selected_ai_model', selectedModel)
        const p4 = updateSettingAction('exports_v2_grouping_model', v2GroupingModel || selectedModel)
        const p5 = updateSettingAction('exports_v2_product_model', v2ProductModel || selectedModel)
        
        const [r1, r2, r3, r4, r5] = await Promise.all([p1, p2, p3, p4, p5])
        
        if (r1.success && r2.success && r3.success && r4.success && r5.success) {
          setMessage({ type: 'success', text: 'Все настройки успешно сохранены!' })
          setTimeout(() => setMessage(null), 3000)
        } else {
          setMessage({ type: 'error', text: 'Ошибка при сохранении одной или нескольких настроек.' })
        }
    } catch (e: any) {
        setMessage({ type: 'error', text: `Ошибка: ${e.message}` })
    }
    
    setIsSaving(false)
  }

  const addModel = () => {
    if (newModel.trim() && !models.includes(newModel.trim())) {
      setModels([...models, newModel.trim()])
      setNewModel('')
    }
  }

  const removeModel = (m: string) => {
    const remaining = models.filter(mod => mod !== m)
    setModels(remaining)
    if (selectedModel === m) setSelectedModel(remaining[0] || '')
    if (v2GroupingModel === m) setV2GroupingModel(remaining[0] || '')
    if (v2ProductModel === m) setV2ProductModel(remaining[0] || '')
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      
      {/* Model Selection Card */}
      <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-6 border-b border-slate-700 bg-slate-800/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400 border border-emerald-500/20">
                <Cpu size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Выбор модели ИИ</h2>
                <p className="text-sm text-slate-400 mt-1">Выберите активную модель и добавьте новые из OpenRouter.</p>
              </div>
            </div>
        </div>
        
        <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Active model selection */}
                <div className="space-y-4">
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Текущая активная модель</label>
                    <div className="grid grid-cols-1 gap-2">
                        {models.map(m => (
                            <button
                                key={m}
                                onClick={() => setSelectedModel(m)}
                                className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                                    selectedModel === m 
                                    ? 'bg-indigo-500/10 border-indigo-500 text-white shadow-lg' 
                                    : 'bg-slate-900/50 border-slate-700 text-slate-400 hover:border-slate-600'
                                }`}
                            >
                                <span className="font-mono text-sm">{m}</span>
                                {selectedModel === m && <div className="p-1 bg-indigo-500 rounded-full"><Check size={12} className="text-white" /></div>}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Manage models list */}
                <div className="space-y-4">
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Управление доступными моделями</label>
                    <div className="space-y-3">
                        <div className="flex gap-2">
                            <input 
                                value={newModel}
                                onChange={(e) => setNewModel(e.target.value)}
                                placeholder="Напр: openai/gpt-4o"
                                className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-indigo-500"
                            />
                            <button 
                                onClick={addModel}
                                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl transition-all"
                            >
                                <Plus size={20} />
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-2 pt-2">
                            {models.map(m => (
                                <div key={m} className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-400">
                                    <span className="font-mono">{m}</span>
                                    <button onClick={() => removeModel(m)} className="text-slate-600 hover:text-red-400">
                                        <X size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-1 gap-4 border-t border-slate-700 pt-6 md:grid-cols-2">
              <label className="space-y-2">
                <span className="block text-xs font-bold uppercase tracking-widest text-slate-500">V2: группировка альбомов</span>
                <select value={v2GroupingModel} onChange={(event) => setV2GroupingModel(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 font-mono text-sm text-white outline-none focus:border-cyan-500">
                  {models.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              </label>
              <label className="space-y-2">
                <span className="block text-xs font-bold uppercase tracking-widest text-slate-500">V2: обработка товара</span>
                <select value={v2ProductModel} onChange={(event) => setV2ProductModel(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 font-mono text-sm text-white outline-none focus:border-indigo-500">
                  {models.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              </label>
            </div>
        </div>
      </div>

      {/* Rules Editor Card */}
      <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-6 border-b border-slate-700 bg-slate-800/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400 border border-indigo-500/20">
              <Bot size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Общие инструкции и правила для ИИ</h2>
              <p className="text-sm text-slate-400 mt-1">Эти правила дополняют инструкции поставщика.</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {message && (
            <div className={`p-4 rounded-xl flex items-center gap-3 animate-in slide-in-from-top-2 duration-200 ${
              message.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}>
              {message.type === 'success' ? <Info size={20} /> : <ShieldAlert size={20} />}
              <span className="text-sm font-medium">{message.text}</span>
            </div>
          )}

          <div className="relative group">
            <textarea
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              placeholder="Введите общие правила здесь..."
              className="w-full h-[400px] bg-slate-900 border border-slate-700 rounded-2xl px-6 py-6 text-slate-200 text-base font-mono leading-relaxed outline-none focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/5 transition-all custom-scrollbar resize-none shadow-inner"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-slate-900/40 border border-slate-700/50 rounded-xl">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                <Info size={14} className="text-indigo-400" />
                Советы
              </h4>
              <ul className="space-y-2 text-sm text-slate-400 list-disc list-inside marker:text-indigo-500">
                <li>Указывайте правила обработки переносов строк.</li>
                <li>Запрещайте использование иероглифов.</li>
                <li>Опишите формат поля "Name".</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Save Button */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
        <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-3 px-10 py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-2xl font-bold shadow-2xl shadow-indigo-600/40 transition-all hover:scale-105 active:scale-95"
          >
            {isSaving ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Save size={24} />
            )}
            Сохранить все настройки
          </button>
      </div>
    </div>
  )
}
