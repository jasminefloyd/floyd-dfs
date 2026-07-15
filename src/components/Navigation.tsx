import { Link } from 'react-router-dom';

export default function Navigation() {
  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center space-x-8">
          <Link
            to="/"
            className="font-bold text-lg text-primary hover:underline transition-colors duration-[var(--transition-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Fantasy AI
          </Link>
          <Link
            to="/"
            className="text-gray-700 hover:text-gray-900 hover:underline transition-colors duration-[var(--transition-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Scan
          </Link>
          <Link
            to="/design-system"
            className="text-gray-700 hover:text-gray-900 hover:underline text-sm transition-colors duration-[var(--transition-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Design System
          </Link>
        </div>
        <div>
          {/* TODO: Add auth UI here */}
          <span className="text-gray-600">Not logged in</span>
        </div>
      </div>
    </nav>
  );
}
