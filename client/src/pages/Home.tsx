import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  ChevronRight, Zap, Loader2, PlaySquare,
  Home as HomeIcon, MessageSquare, PlusSquare, Search, User,
  RefreshCw, Radio, ChevronLeft, Menu, X
} from 'lucide-react';
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { FaFacebook, FaInstagram, FaTwitch, FaMastodon, FaYoutube, FaGithub, FaRegNewspaper } from 'react-icons/fa';
import { FaXTwitter, FaBluesky, FaThreads } from 'react-icons/fa6';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * SYNAPSE Home Page — Cyberpunk Minimalism with Sidebar Navigation
 */

const PLATFORMS = [
  { id: 'all',       label: '_All',      color: 'text-cyan-400',   accent: '#22d3ee' },
  { id: 'news',      label: 'News',      color: 'text-orange-400', accent: '#fb923c' },
  { id: 'bluesky',   label: 'Bluesky',   color: 'text-blue-400',   accent: '#60a5fa' },
  { id: 'youtube',   label: 'YouTube',   color: 'text-red-400',    accent: '#f87171' },
  { id: 'github',    label: 'GitHub',    color: 'text-gray-300',   accent: '#d1d5db' },
  { id: 'twitter',   label: 'Twitter',   color: 'text-sky-400',    accent: '#38bdf8' },
  { id: 'facebook',  label: 'Facebook',  color: 'text-blue-600',   accent: '#2563eb' },
  { id: 'instagram', label: 'Instagram', color: 'text-pink-500',   accent: '#ec4899' },
  { id: 'threads',   label: 'Threads',   color: 'text-white',      accent: '#ffffff' },
  { id: 'twitch',    label: 'Twitch',    color: 'text-purple-400', accent: '#c084fc' },
  { id: 'mastodon',  label: 'Mastodon',  color: 'text-indigo-400', accent: '#818cf8' },
];

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  twitter:   <FaXTwitter />,
  facebook:  <FaFacebook />,
  instagram: <FaInstagram />,
  bluesky:   <FaBluesky />,
  threads:   <FaThreads />,
  twitch:    <FaTwitch />,
  mastodon:  <FaMastodon />,
  github:    <FaGithub />,
  youtube:   <FaYoutube />,
  news:      <FaRegNewspaper />,
};

const getPlatformColor = (platform: string) => {
  return PLATFORMS.find(p => p.id === platform)?.color || 'text-cyan-400';
};
const getPlatformAccent = (platform: string) => {
  return PLATFORMS.find(p => p.id === platform)?.accent || '#22d3ee';
};

const Logo = () => (
  <div className="relative w-12 h-12 flex items-center justify-center flex-shrink-0 group">
    <div className="absolute inset-0 bg-cyan-500/20 rounded-full blur-xl group-hover:bg-cyan-500/40 transition-colors duration-500" />
    <div className="relative w-10 h-10 bg-black/60 border border-cyan-500/40 rounded-xl flex items-center justify-center backdrop-blur-md shadow-[0_0_15px_rgba(6,182,212,0.3)] group-hover:border-cyan-400 group-hover:shadow-[0_0_20px_rgba(6,182,212,0.6)] transition-all duration-300">
      <Zap className="text-cyan-400 group-hover:text-cyan-300 group-hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.8)] transition-all duration-300" size={20} />
    </div>
  </div>
);

export default function Home() {
  const { isAuthenticated } = useAuth();
  const [activeFilter, setActiveFilter] = useState('all');
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const observerTarget = useRef<HTMLDivElement>(null);

  const handlePlayVideo = useCallback((videoId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPlayingVideoId(videoId);
  }, []);

  // ---- Infinite Query --------------------------------------------------
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
    isRefetching,
  } = trpc.feed.getPosts.useInfiniteQuery(
    {
      platform: activeFilter === 'all' ? undefined : activeFilter,
    },
    {
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? null,
    }
  );

  // Reset scroll and refetch when filter changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeFilter]);

  // ---- Flatten pages ---------------------------------------------------
  const feeds = useMemo(() => {
    if (!data) return [];
    return data.pages.flatMap(page =>
      page.items.map(post => {
        const metrics  = post.engagementMetrics  ? JSON.parse(post.engagementMetrics)  : {};
        const metadata = post.platformMetadata   ? JSON.parse(post.platformMetadata)   : {};
        return {
          id:        String(post.id),
          platform:  post.platform,
          author:    post.author,
          content:   post.content,
          title:     post.title,
          likes:     metrics.likes  ?? metrics.favs,
          reposts:   metrics.retweets ?? metrics.boosts ?? metrics.reposts,
          replies:   metrics.replies ?? metrics.comments,
          stars:     metrics.stars,
          viewers:   metrics.viewers,
          views:     metrics.views,
          isLive:    metadata.isLive,
          videoId:   metadata.videoId ?? null,
          thumbnail: metadata.thumbnail ?? metadata.urlToImage ?? null,
          url:       metadata.url ?? null,
          icon:      PLATFORM_ICONS[post.platform] ?? <Zap />,
          timestamp: new Date(post.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
      })
    );
  }, [data]);

  // ---- Infinite scroll observer ----------------------------------------
  useEffect(() => {
    const el = observerTarget.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1, rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // ---- Active platform meta --------------------------------------------
  const activePlatform = PLATFORMS.find(p => p.id === activeFilter) ?? PLATFORMS[0];

  return (
    <div className="min-h-screen bg-black text-white font-sans flex">
      {/* ================================================================
          SIDEBAR
          ================================================================ */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside
            key="sidebar"
            initial={{ x: -280, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -280, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed top-0 left-0 h-screen w-64 bg-black/95 border-r border-cyan-500/20 z-50 flex flex-col overflow-y-auto"
          >
            {/* Sidebar header */}
            <div className="flex items-center justify-between px-5 py-5 border-b border-cyan-500/20">
              <div className="flex items-center gap-3">
                <Logo />
                <div>
                  <p className="font-black italic text-2xl tracking-tighter leading-none">
                    SYNAPSE<span className="text-cyan-400">.</span>
                  </p>
                  <p className="text-[9px] font-mono text-cyan-400/60 tracking-widest uppercase">neural feeds</p>
                </div>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="p-1.5 rounded hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Platform nav */}
            <div className="flex-1 py-4 px-3">
              <p className="px-2 mb-3 text-[9px] font-sans font-bold tracking-[0.3em] text-indigo-500/80 uppercase">
                Neural Sources
              </p>
              <nav className="flex flex-col gap-1">
                {PLATFORMS.map((platform, idx) => {
                  const isActive = activeFilter === platform.id;
                  return (
                    <button
                      key={platform.id}
                      onClick={() => setActiveFilter(platform.id)}
                      className={`group relative w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-left transition-all duration-200 ${
                        isActive
                          ? 'bg-cyan-500/10 border-l-2 border-cyan-500'
                          : 'border-l border-transparent hover:bg-white/5 hover:border-l hover:border-white/20'
                      }`}
                    >
                      <span className={`text-[9px] font-mono w-6 flex-shrink-0 ${isActive ? 'text-cyan-400' : 'text-gray-600'}`}>
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <span className={`text-sm flex items-center gap-2 font-black italic tracking-wide transition-colors ${
                        isActive ? platform.color : 'text-gray-500 group-hover:text-gray-200'
                      }`}>
                        {PLATFORM_ICONS[platform.id] ? (
                          <span className="text-base">{PLATFORM_ICONS[platform.id]}</span>
                        ) : (
                          <Radio size={14} />
                        )}
                        {platform.label}
                      </span>
                      {isActive && (
                        <motion.div
                          layoutId="activeIndicator"
                          className="ml-auto w-1.5 h-1.5 rounded-full bg-cyan-400"
                        />
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Sidebar bottom actions */}
            <div className="border-t border-indigo-500/20 px-3 py-4 space-y-1">
              <a
                href={isAuthenticated ? '#' : getLoginUrl()}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-mono text-gray-400 hover:text-cyan-400 hover:bg-cyan-500/5 transition-all"
              >
                <ChevronRight size={14} />
                {isAuthenticated ? 'Dashboard' : 'Get Started'}
              </a>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Sidebar toggle button (visible when sidebar is closed) */}
      <AnimatePresence>
        {!sidebarOpen && (
          <motion.button
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            onClick={() => setSidebarOpen(true)}
            className="fixed top-5 left-4 z-50 flex items-center gap-2 px-3 py-2 bg-black/90 border border-cyan-500/40 rounded text-cyan-400 hover:bg-cyan-500/10 transition-all font-mono text-xs"
          >
            <Menu size={14} />
            <Logo />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ================================================================
          MAIN CONTENT
          ================================================================ */}
      <div
        className="flex-1 transition-all duration-300"
        style={{ marginLeft: sidebarOpen ? '256px' : '0' }}
      >
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-indigo-500/20">
          <div
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage: 'url(https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop)',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 to-black" />
          <div className="relative px-8 py-16 lg:py-24 max-w-4xl">
            <p className="text-[10px] font-sans font-bold tracking-[0.25em] text-indigo-400 uppercase mb-2">
              All your socials, one feed.
            </p>
            <h1 className="text-5xl lg:text-7xl font-black italic tracking-tighter leading-none mb-4 text-white">
              SYNAPSE<span className="text-indigo-400">.</span>
            </h1>
            <p className="text-base text-gray-400 max-w-xl leading-relaxed">
              Real-time aggregation from live neural sources across the web.
            </p>
          </div>
        </section>

        {/* Feed header */}
        <section className="sticky top-0 z-40 bg-black/90 backdrop-blur-md border-b border-cyan-500/15 px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-0.5 h-5 bg-indigo-500 animate-pulse" />
            <span className={`font-black italic text-lg tracking-wide ${activePlatform.color}`}>
              {activePlatform.label}
            </span>
            {feeds.length > 0 && (
              <span className="text-[10px] font-sans text-gray-400">
                {feeds.length} signal{feeds.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </section>

        <section className="px-6 lg:px-8 py-8">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-32">
              <Loader2 className="h-10 w-10 text-indigo-500 animate-spin mb-4" />
              <p className="text-indigo-400 font-sans text-sm animate-pulse">Syncing Signals...</p>
            </div>
          ) : feeds.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32 text-gray-500">
              <Radio size={40} className="mb-4 opacity-30" />
              <p className="font-sans text-sm">No signal detected</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {feeds.map(feed => (
                  <motion.div
                    key={feed.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    onClick={() => feed.url ? window.open(feed.url, '_blank') : undefined}
                    className="group relative p-5 border border-white/10 rounded-lg bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.05] transition-all duration-300 cursor-pointer overflow-hidden"
                    style={{
                      '--accent': getPlatformAccent(feed.platform),
                    } as React.CSSProperties}
                  >
                    {/* Accent glow on hover */}
                    <div
                      className="absolute top-0 left-0 right-0 h-px opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      style={{ background: `linear-gradient(90deg, transparent, ${getPlatformAccent(feed.platform)}, transparent)` }}
                    />

                    {/* Card header */}
                    <div className="flex items-start gap-3 mb-3">
                      <span className={`text-xl mt-0.5 ${getPlatformColor(feed.platform)}`}>
                        {feed.icon}
                      </span>
                      <div className="min-w-0">
                        <p className={`text-[10px] font-bold uppercase tracking-widest ${getPlatformColor(feed.platform)}`}>
                          {feed.platform}
                        </p>
                        <p className="text-sm font-bold truncate text-gray-200">
                          {feed.title || feed.author}
                        </p>
                      </div>
                      {feed.isLive && (
                        <span className="ml-auto flex-shrink-0 flex items-center gap-1 px-2 py-0.5 bg-red-500/20 border border-red-500/40 rounded text-[9px] font-mono text-red-400 uppercase">
                          <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />
                          Live
                        </span>
                      )}
                    </div>

                    {/* YouTube thumbnail */}
                    {feed.platform === 'youtube' && feed.videoId ? (
                      <div className="mb-3 relative w-full rounded-xl overflow-hidden bg-black" style={{ aspectRatio: '21/9' }}>
                        {playingVideoId === feed.videoId ? (
                          <iframe
                            className="absolute inset-0 w-full h-full"
                            src={`https://www.youtube.com/embed/${feed.videoId}?autoplay=1`}
                            title={feed.title || 'YouTube'}
                            frameBorder="0"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowFullScreen
                          />
                        ) : (
                          <>
                            <img
                              src={feed.thumbnail || ''}
                              alt={feed.title || 'YouTube'}
                              className="absolute inset-0 w-full h-full object-cover"
                            />
                            <div
                              onClick={e => handlePlayVideo(feed.videoId!, e)}
                              className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/20 transition-colors"
                            >
                              <div className="w-14 h-14 rounded-full bg-red-600/90 backdrop-blur flex items-center justify-center shadow-2xl hover:scale-110 transition-transform">
                                <PlaySquare size={24} className="text-white ml-1" />
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ) : feed.platform === 'news' ? (
                      <div className="mb-3">
                        {feed.thumbnail && (
                          <img
                            src={feed.thumbnail}
                            alt={feed.title || 'News'}
                            className="w-full aspect-[21/9] object-cover rounded-xl mb-3 border border-orange-500/10 shadow-lg"
                            onError={e => (e.currentTarget.style.display = 'none')}
                          />
                        )}
                        <p className="text-sm text-gray-300 line-clamp-3 leading-relaxed">{feed.content}</p>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-300 mb-3 leading-relaxed line-clamp-4">{feed.content}</p>
                    )}

                    {/* Footer metrics */}
                    <div className="pt-3 border-t border-white/5 flex flex-wrap gap-3 text-[10px] font-mono text-gray-600">
                      {feed.likes    != null && <span>♥ {Number(feed.likes).toLocaleString()}</span>}
                      {feed.reposts  != null && <span>↻ {Number(feed.reposts).toLocaleString()}</span>}
                      {feed.stars    != null && <span>★ {Number(feed.stars).toLocaleString()}</span>}
                      {feed.viewers  != null && <span>👁 {feed.viewers}</span>}
                      <span className="ml-auto">{feed.timestamp}</span>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Infinite scroll sentinel */}
              <div ref={observerTarget} className="h-24 flex items-center justify-center mt-8">
                {isFetchingNextPage ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-6 w-6 text-indigo-500 animate-spin" />
                    <p className="text-xs font-sans text-indigo-400/80">Loading next signals...</p>
                  </div>
                ) : hasNextPage ? (
                  <div className="flex flex-col items-center gap-1 opacity-30">
                    <div className="w-px h-8 bg-indigo-500" />
                    <p className="text-xs font-sans text-indigo-400">scroll</p>
                  </div>
                ) : (
                  <p className="text-gray-600 font-sans text-xs uppercase tracking-widest">End of Signal</p>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
