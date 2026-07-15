import { useState } from 'react';
import { COLORS, SPACING, SHADOWS } from '../lib/theme';
import { PlayerListSkeleton, LineupSkeleton } from '../components/Skeleton';
import { useToast } from '../components/ToastProvider';
import { useEnterTransition } from '../hooks/useEnterTransition';

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const TRANSITION_FAST = 'transition-colors duration-[var(--transition-fast)]';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-16">
      <h2 className="text-2xl font-bold mb-6 border-b border-gray-200 pb-2">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex flex-col items-start">
      <div
        className="w-24 h-24 rounded-lg border border-gray-200 mb-2"
        style={{ backgroundColor: value }}
      />
      <p className="text-sm font-medium">{name}</p>
      <p className="text-xs text-gray-500 font-mono">{value}</p>
    </div>
  );
}

const GRAY_PALETTE = [
  ['gray-50', '#f9fafb'],
  ['gray-100', '#f3f4f6'],
  ['gray-300', '#d1d5db'],
  ['gray-500', '#6b7280'],
  ['gray-700', '#374151'],
  ['gray-900', '#111827']
];

function ExampleModal({ onClose }: { onClose: () => void }) {
  const entered = useEnterTransition([]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div
        className={`bg-white rounded-lg p-6 w-full max-w-sm transition-all duration-[var(--transition-default)] ${
          entered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
        style={{ boxShadow: SHADOWS.strong }}
      >
        <h3 className="text-lg font-bold mb-2">Example Modal</h3>
        <p className="text-sm text-gray-600 mb-6">This is example modal content.</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className={`px-4 py-2 text-sm rounded-md border border-gray-300 ${TRANSITION_FAST} ${FOCUS_RING}`}
          >
            Cancel
          </button>
          <button
            onClick={onClose}
            className={`px-4 py-2 text-sm rounded-md bg-primary text-white ${TRANSITION_FAST} ${FOCUS_RING}`}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DesignSystem() {
  const [modalOpen, setModalOpen] = useState(false);
  const { showToast } = useToast();

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-8 overflow-y-auto">
      <h1 className="text-3xl font-bold mb-2">Design System</h1>
      <p className="text-gray-600 mb-12">
        All design tokens and reusable components used across Fantasy AI.
      </p>

      {/* Colors */}
      <Section title="Colors">
        <div className="flex flex-wrap gap-6 mb-8">
          <Swatch name="Primary" value={COLORS.primary} />
          <Swatch name="Secondary" value={COLORS.secondary} />
          <Swatch name="Success" value={COLORS.success} />
          <Swatch name="Error" value={COLORS.error} />
        </div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Gray palette</h3>
        <div className="flex flex-wrap gap-6">
          {GRAY_PALETTE.map(([name, value]) => (
            <Swatch key={name} name={name} value={value} />
          ))}
        </div>
      </Section>

      {/* Typography */}
      <Section title="Typography">
        <div className="space-y-4">
          <h1 className="text-4xl font-bold">H1 Heading</h1>
          <h2 className="text-3xl font-bold">H2 Heading</h2>
          <h3 className="text-2xl font-semibold">H3 Heading</h3>
          <h4 className="text-xl font-semibold">H4 Heading</h4>
          <p className="text-base">Body text — the default paragraph style used everywhere.</p>
          <p className="text-[13px] text-gray-500">Caption text — smaller, muted, for secondary info.</p>
          <code className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">
            const code = 'monospace sample';
          </code>
        </div>
      </Section>

      {/* Spacing */}
      <Section title="Spacing (4px grid)">
        <div className="space-y-3">
          {Object.entries(SPACING).map(([name, value]) => (
            <div key={name} className="flex items-center gap-4">
              <span className="w-12 text-xs font-mono text-gray-500">{name}</span>
              <div className="bg-blue-600 h-4" style={{ width: value }} />
              <span className="text-xs text-gray-500">{value}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Buttons */}
      <Section title="Buttons">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div>
            <p className="text-xs text-gray-500 mb-2">Primary</p>
            <div className="space-y-2">
              <button className={`w-full bg-primary hover:bg-primary-dark text-white font-semibold py-2 px-4 rounded-md ${TRANSITION_FAST} ${FOCUS_RING}`}>
                Default (hover me)
              </button>
              <button disabled className="w-full bg-gray-300 text-gray-500 font-semibold py-2 px-4 rounded-md cursor-not-allowed">
                Disabled
              </button>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-2">Secondary</p>
            <div className="space-y-2">
              <button className={`w-full bg-secondary hover:bg-secondary/90 text-white font-semibold py-2 px-4 rounded-md ${TRANSITION_FAST} ${FOCUS_RING}`}>
                Default (hover me)
              </button>
              <button disabled className="w-full bg-gray-200 text-gray-400 font-semibold py-2 px-4 rounded-md cursor-not-allowed">
                Disabled
              </button>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-2">Ghost</p>
            <div className="space-y-2">
              <button className={`w-full border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold py-2 px-4 rounded-md ${TRANSITION_FAST} ${FOCUS_RING}`}>
                Default (hover me)
              </button>
              <button disabled className="w-full border border-gray-200 text-gray-300 font-semibold py-2 px-4 rounded-md cursor-not-allowed">
                Disabled
              </button>
            </div>
          </div>
        </div>
      </Section>

      {/* Inputs */}
      <Section title="Inputs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Text input</label>
            <input type="text" placeholder="Default" className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary ${TRANSITION_FAST}`} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Text input (disabled)</label>
            <input type="text" placeholder="Disabled" disabled className="w-full px-3 py-2 border border-gray-200 bg-gray-100 text-gray-400 rounded-md" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Text input (error)</label>
            <input type="text" placeholder="Invalid value" className={`w-full px-3 py-2 border border-red-400 rounded-md focus:outline-none focus:ring-2 focus:ring-error focus:border-error ${TRANSITION_FAST}`} />
            <p className="text-xs text-red-600 mt-1">This field is required.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select</label>
            <select className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary ${TRANSITION_FAST}`}>
              <option>Option A</option>
              <option>Option B</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Textarea</label>
            <textarea placeholder="Default" rows={3} className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary ${TRANSITION_FAST}`} />
          </div>
        </div>
      </Section>

      {/* Cards */}
      <Section title="Cards">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="bg-white border border-gray-200 rounded-lg p-6" style={{ boxShadow: SHADOWS.subtle }}>
            <p className="text-sm text-gray-700">Default card — no header, subtle shadow.</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden" style={{ boxShadow: SHADOWS.medium }}>
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-3">
              <h3 className="font-bold">Card with header</h3>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-700">Card body content goes here.</p>
            </div>
          </div>
        </div>
      </Section>

      {/* Badges */}
      <Section title="Badges">
        <div className="flex gap-3">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-success/10 text-success">Success</span>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-warning/10 text-warning">Warning</span>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-error/10 text-error">Error</span>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary">Info</span>
        </div>
      </Section>

      {/* Alerts */}
      <Section title="Alerts">
        <div className="space-y-3">
          <div className="bg-success/10 border border-success/30 rounded-md p-4 text-sm text-success">
            Success — your lineup was saved.
          </div>
          <div className="bg-warning/10 border border-warning/30 rounded-md p-4 text-sm text-warning">
            Warning — this player is questionable for tonight.
          </div>
          <div className="bg-error/10 border border-error/30 rounded-md p-4 text-sm text-error">
            Error — scan failed, please try again.
          </div>
          <div className="bg-primary/10 border border-primary/30 rounded-md p-4 text-sm text-primary">
            Info — new slate data is available.
          </div>
        </div>
      </Section>

      {/* Modals */}
      <Section title="Modals">
        <button
          onClick={() => setModalOpen(true)}
          className={`bg-primary hover:bg-primary-dark text-white font-semibold py-2 px-4 rounded-md ${TRANSITION_FAST} ${FOCUS_RING}`}
        >
          Open example modal
        </button>
        {modalOpen && <ExampleModal onClose={() => setModalOpen(false)} />}
      </Section>

      {/* Toasts */}
      <Section title="Toasts">
        <div className="flex gap-3">
          <button
            onClick={() => showToast('Lineup saved!', 'success')}
            className={`bg-success hover:bg-success/90 text-white font-semibold py-2 px-4 rounded-md ${TRANSITION_FAST} ${FOCUS_RING}`}
          >
            Show success toast
          </button>
          <button
            onClick={() => showToast('Failed to scan', 'error')}
            className={`bg-error hover:bg-error/90 text-white font-semibold py-2 px-4 rounded-md ${TRANSITION_FAST} ${FOCUS_RING}`}
          >
            Show error toast
          </button>
          <button
            onClick={() => showToast('Using cached data', 'info')}
            className={`bg-primary hover:bg-primary-dark text-white font-semibold py-2 px-4 rounded-md ${TRANSITION_FAST} ${FOCUS_RING}`}
          >
            Show info toast
          </button>
        </div>
        <p className="text-[13px] text-gray-500 mt-3">Toasts auto-dismiss after 3s. Watch the bottom-right corner.</p>
      </Section>

      {/* Skeleton loaders */}
      <Section title="Skeleton Loaders">
        <p className="text-[13px] text-gray-500 mb-4">Player list skeleton (used while scanning):</p>
        <PlayerListSkeleton rows={3} />
        <p className="text-[13px] text-gray-500 mb-4 mt-8">Lineup skeleton (used while generating):</p>
        <LineupSkeleton count={2} />
      </Section>
    </div>
  );
}
