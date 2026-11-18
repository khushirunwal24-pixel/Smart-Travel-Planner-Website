import React, { useEffect, useState } from 'react';
import { X, Database, ShieldCheck, ExternalLink, Cpu, Globe, Image as ImageIcon } from 'lucide-react';
import {
  AttributionResponse,
  fetchAttributionInfo,
  fetchModelStatus,
  ModelStatusSummary,
} from '../services/aiPlannerService';

interface AttributionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AttributionModal: React.FC<AttributionModalProps> = ({ isOpen, onClose }) => {
  const [data, setData] = useState<AttributionResponse | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatusSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    Promise.all([fetchAttributionInfo(), fetchModelStatus()])
      .then(([attrRes, modRes]) => {
        setData(attrRes);
        setModelStatus(modRes);
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-blue-900 to-teal-800 p-5 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center">
              <Database className="w-5 h-5 text-teal-300" />
            </div>
            <div>
              <h3 className="font-bold text-base font-heading">Data Attribution, Licensing & ML Status</h3>
              <p className="text-[11px] text-blue-200">
                Open worldwide travel-place sources & transparent recommendation status
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/15 text-white transition-colors cursor-pointer"
            aria-label="Close Attribution Modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-700">
          {loading && (
            <div className="py-8 text-center text-slate-500">
              Loading live dataset attribution & model readiness...
            </div>
          )}

          {!loading && (
            <>
              {/* Live Catalog & ML Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900">
                    <Globe className="w-4 h-4 text-blue-600" />
                    <span>MongoDB Place Catalog</span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Indexed places:{' '}
                    <strong className="text-slate-900">
                      {data?.datasetStats?.placesCount?.toLocaleString('en-IN') ?? 0}
                    </strong>{' '}
                    across{' '}
                    <strong className="text-slate-900">
                      {data?.datasetStats?.citiesCount?.toLocaleString('en-IN') ?? 0}
                    </strong>{' '}
                    destinations
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Database: {data?.datasetStats?.mongodb?.connected ? 'Connected (2dsphere active)' : 'Fallback / Offline'}
                  </p>
                </div>

                <div className="p-3.5 rounded-2xl bg-blue-50/70 border border-blue-200 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900">
                    <Cpu className="w-4 h-4 text-teal-600" />
                    <span>ML Attraction Ranker</span>
                  </div>
                  <p className="text-[11px] text-slate-700">
                    Active Mode:{' '}
                    <strong className="text-blue-800">
                      {modelStatus?.mode === 'onnx'
                        ? `LightGBM ONNX (${modelStatus.modelVersion})`
                        : 'Transparent Baseline Ranker'}
                    </strong>
                  </p>
                  <p className="text-[11px] text-slate-600">
                    Real feedback samples:{' '}
                    <strong>
                      {modelStatus?.feedbackCount ?? 0} / {modelStatus?.minRequiredSamples ?? 50}
                    </strong>{' '}
                    ({modelStatus?.distinctQueryGroups ?? 0} / {modelStatus?.minRequiredGroups ?? 10} groups)
                  </p>
                </div>
              </div>

              {modelStatus?.reason && (
                <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] leading-relaxed">
                  <strong>Honest ML Readiness:</strong> {modelStatus.reason}
                </div>
              )}

              {/* Provider Attribution List */}
              <div className="space-y-2.5">
                <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" /> Data Sources & Licences
                </h4>
                <div className="space-y-2">
                  {(data?.sources || []).map((src) => (
                    <div
                      key={src.source}
                      className="p-3.5 rounded-2xl border border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-slate-900 capitalize">{src.source}</span>
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-semibold">
                            {src.licence}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600">{src.attribution}</p>
                      </div>
                      {src.url && (
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline text-[11px] font-semibold inline-flex items-center gap-1 shrink-0"
                        >
                          Source <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Image & Integrity Policy */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5 text-[11px] text-slate-600">
                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-slate-600" />
                  <span>Media Rights & Data Integrity Policy</span>
                </div>
                <p>
                  {data?.imagePolicy ||
                    'Attraction photographs are displayed solely via direct external URLs with explicit image source attribution. CC-BY text licences do not transfer bulk image rights.'}
                </p>
                <p>
                  Entrance fees, ratings, reviews, and opening hours are never fabricated; when unavailable in open data, cards explicitly indicate missing pricing or clearly label duration estimates.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
