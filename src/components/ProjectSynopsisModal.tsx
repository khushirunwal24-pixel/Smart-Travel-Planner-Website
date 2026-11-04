import React from 'react';
import { X, Award, FileText, CheckCircle, Compass, Users, GraduationCap } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const ProjectSynopsisModal: React.FC<Props> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-teal-500 text-white p-6 relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3 mb-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 text-xs font-semibold backdrop-blur-md">
              <Award className="w-3.5 h-3.5" /> Mini Project Synopsis
            </span>
          </div>
          <h2 className="text-xl md:text-2xl font-bold font-heading">
            Smart Travel Planner – An Intelligent Trip Planning & Budget Management Website
          </h2>
          <p className="text-blue-100 text-xs mt-1">
            Academic Project Specification & Architectural Implementation
          </p>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-slate-700 text-sm">
          {/* Introduction */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
            <h4 className="font-semibold text-slate-900 flex items-center gap-2 mb-1.5">
              <FileText className="w-4 h-4 text-blue-600" /> Introduction
            </h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              Travelers frequently face difficulties in planning trips, as manually researching destinations, routes,
              budgets, and accommodation across scattered sources is time-consuming and disorganized. Smart Travel
              Planner is a web-based platform that helps users plan trips efficiently by generating personalized
              itineraries, estimating budgets, and suggesting optimal routes from a single, intuitive interface.
            </p>
          </div>

          {/* Objectives */}
          <div>
            <h4 className="font-semibold text-slate-900 flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-emerald-600" /> Key Objectives
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-50/50 border border-blue-100">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-1.5 shrink-0" />
                <span>Create an easy-to-use modern platform for planning trips</span>
              </div>
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-teal-50/50 border border-teal-100">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-600 mt-1.5 shrink-0" />
                <span>Generate personalized day-wise itineraries based on traveler preferences</span>
              </div>
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-indigo-50/50 border border-indigo-100">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 mt-1.5 shrink-0" />
                <span>Provide dynamic budget estimation and real-time expense tracking</span>
              </div>
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50/50 border border-amber-100">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-600 mt-1.5 shrink-0" />
                <span>Recommend optimal travel routes, interactive maps, and live weather</span>
              </div>
            </div>
          </div>

          {/* Methodology */}
          <div>
            <h4 className="font-semibold text-slate-900 flex items-center gap-2 mb-2">
              <Compass className="w-4 h-4 text-indigo-600" /> Methodology (Agile Development)
            </h4>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-3 py-1.5 rounded-lg bg-slate-100 font-medium text-slate-700">1. Requirement Analysis</span>
              <span className="px-3 py-1.5 rounded-lg bg-slate-100 font-medium text-slate-700">2. UI/UX Design</span>
              <span className="px-3 py-1.5 rounded-lg bg-slate-100 font-medium text-slate-700">3. Full-Stack Development</span>
              <span className="px-3 py-1.5 rounded-lg bg-slate-100 font-medium text-slate-700">4. Functional Testing</span>
              <span className="px-3 py-1.5 rounded-lg bg-slate-100 font-medium text-slate-700">5. Cloud Deployment</span>
            </div>
          </div>

          {/* Project Team and Mentor details */}
          <div className="border-t border-slate-200 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
                <Users className="w-4 h-4 text-blue-600" /> Team Member
              </div>
              <div className="font-semibold text-slate-900 text-sm">Garima Runwal</div>
              <div className="text-xs text-slate-500 font-mono">Roll No: 24036142</div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
                <GraduationCap className="w-4 h-4 text-teal-600" /> Choice of Mentor
              </div>
              <div className="font-semibold text-slate-900 text-sm">Mrs. Akanksha Gupta</div>
              <div className="text-xs text-slate-500">Project Guide & Supervisor</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-semibold rounded-xl bg-slate-900 hover:bg-slate-800 text-white transition-colors"
          >
            Close Synopsis
          </button>
        </div>
      </div>
    </div>
  );
};
