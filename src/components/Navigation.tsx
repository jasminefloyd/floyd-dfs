import { Link } from 'react-router-dom';

export default function Navigation() {
  return <nav className="bg-[#0b1f3a] px-3 py-3 text-white sm:px-6"><div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3"><div className="flex min-w-0 items-center gap-3 sm:gap-6"><Link to="/" className="min-w-0 text-base font-black tracking-wide text-white transition-colors hover:text-cyan-200 sm:text-lg">FLOYD DFS</Link><Link to="/" className="rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-cyan-100">Scan</Link><div className="flex min-w-0 items-center gap-3 overflow-x-auto pb-0.5"><Link to="/history" className="whitespace-nowrap text-xs font-bold text-blue-100 hover:text-white">History</Link><Link to="/learning" className="whitespace-nowrap text-xs font-bold text-blue-100 hover:text-white">Learning</Link></div></div></div></nav>;
}
