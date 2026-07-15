import { Link } from 'react-router-dom';

interface AdminConsoleProps {
  children?: React.ReactNode;
}

export default function AdminConsole({ children }: AdminConsoleProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Admin Console</h1>
            <p className="text-sm text-gray-600">Fantasy AI operations and internal tools</p>
          </div>
          <nav className="flex gap-3 text-sm">
            <Link to="/admin/design-system" className="text-primary hover:underline">
              Design System
            </Link>
          </nav>
        </div>
      </div>
      <main>{children}</main>
    </div>
  );
}
