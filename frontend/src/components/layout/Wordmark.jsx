// "RAMS · Accounts" beside the Royal Mart badge -- the sister-app mark. `tone`
// is 'light' on the green top bar and 'dark' on the pale sign-in pages.
export default function Wordmark({ tone = 'light', size = 'md' }) {
  const text = tone === 'light' ? 'text-white' : 'text-brand';
  const sub = tone === 'light' ? 'text-white/60' : 'text-brand/60';
  const big = size === 'lg';
  return (
    <span className="inline-flex items-center gap-2.5">
      <img src="/logo-icon-48.png" alt="Royal Mart" className={`${big ? 'h-12 w-12' : 'h-8 w-8'} rounded-md shadow-sm`} />
      <span className="leading-tight text-left">
        <span className={`block font-bold tracking-wide ${text} ${big ? 'text-2xl' : 'text-base'}`}>RAMS</span>
        <span className={`block ${sub} ${big ? 'text-sm' : 'text-[11px]'}`}>Royal Mart · Accounts</span>
      </span>
    </span>
  );
}
