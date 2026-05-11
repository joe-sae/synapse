import { Button } from "@/components/ui/button";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-black text-white font-sans overflow-hidden relative">
      {/* Background Decorative Elements */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
      <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
      <div className="absolute top-0 left-1/4 w-px h-full bg-cyan-500/5" />
      <div className="absolute top-0 right-1/4 w-px h-full bg-cyan-500/5" />

      <div className="relative z-10 max-w-lg w-full mx-6 p-8 border border-cyan-500/20 bg-cyan-500/5 rounded backdrop-blur-sm shadow-2xl shadow-cyan-500/5">
        <div className="flex flex-col items-center text-center">
          <div className="mb-6 inline-block p-4 bg-cyan-500/10 rounded-full border border-cyan-500/30 animate-pulse">
            <AlertTriangle className="h-12 w-12 text-cyan-400" />
          </div>

          <div className="mb-2">
            <span className="text-xs font-mono font-bold tracking-widest text-cyan-500 uppercase">
              // Error_Code: 404
            </span>
          </div>
          
          <h1 className="text-5xl font-black italic tracking-tighter mb-4">
            SIGNAL LOST<span className="text-cyan-400">_</span>
          </h1>

          <p className="text-gray-400 font-mono text-sm mb-8 leading-relaxed">
            The requested neural path could not be established. 
            The signal may have been redacted or the protocol is deprecated.
          </p>

          <div className="w-full h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent mb-8" />

          <Button
            onClick={handleGoHome}
            className="px-8 py-3 bg-cyan-500 text-black font-bold rounded hover:bg-cyan-400 transition-all hover:shadow-lg hover:shadow-cyan-500/50 flex items-center gap-2"
          >
            <ChevronLeft size={18} />
            RE-ROUTE TO HOME
          </Button>
          
          <div className="mt-8 text-[10px] font-mono text-gray-600 uppercase tracking-widest">
            System Status: Nominal | Trace ID: {Math.random().toString(16).substring(2, 10).toUpperCase()}
          </div>
        </div>
      </div>
    </div>
  );
}
