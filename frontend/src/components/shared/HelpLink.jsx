import { Link } from 'react-router-dom';
import { LifeBuoy } from 'lucide-react';

// A page's own "Help" link, to its section of the user guide (src/help).
export default function HelpLink({ section, className = '' }) {
  return (
    <Link
      to={`/help#${section}`}
      className={`inline-flex items-center gap-1 text-sm text-brand hover:underline ${className}`}
      aria-label="Help for this page"
    >
      <LifeBuoy size={14} /> Help
    </Link>
  );
}
