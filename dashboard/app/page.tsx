import CameraFeed from "@/components/CameraFeed";
import Clock from "@/components/Clock";
import DetectionPanel from "@/components/DetectionPanel";
import NodeCard from "@/components/NodeCard";
import SparkInference from "@/components/SparkInference";
import VoiceAssistant from "@/components/VoiceAssistant";
import { NODES } from "@/lib/nodes";

export default function Home() {
  const streamNodes = NODES.filter((n) => n.streamUrl && n.apiRoute);

  return (
    <div className="min-h-screen p-6 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <header className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="font-mono text-xl font-bold uppercase tracking-widest text-zinc-100">
            LocalGuard
          </h1>
          <p className="font-mono text-xs text-zinc-600 mt-1">
            Distributed edge AI monitoring
          </p>
        </div>
        <Clock />
      </header>

      {/* Node Status Grid */}
      <section className="mb-8">
        <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-500 mb-3">
          Nodes
        </h2>
        <div className="bg-zinc-800 grid gap-px sm:grid-cols-3 border border-zinc-800 overflow-hidden">
          {NODES.map((node) => (
            <NodeCard key={node.id} node={node} />
          ))}
        </div>
      </section>

      {/* Observations + Detections + Voice */}
      <div className="grid gap-8 lg:grid-cols-3 mb-8">
        <SparkInference />
        <DetectionPanel />
        <VoiceAssistant />
      </div>

      {/* Video Feeds */}
      <section>
        <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-500 mb-3">
          Feeds
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {streamNodes.map((node) => (
            <CameraFeed
              key={node.id}
              label={node.name}
              apiRoute={node.apiRoute!}
              streamUrl={node.streamUrl!}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
