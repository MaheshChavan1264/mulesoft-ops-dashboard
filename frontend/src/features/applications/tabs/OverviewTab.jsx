import React from 'react';
import { Activity, GitBranch, Layers, Clock, Server, Hash, Boxes, Package, Database, Globe } from 'lucide-react';
import TableHeader from '../../../components/ui/TableHeader';
import CopyBtn from '../../../components/shared/CopyBtn';
import { GlassCard, SectionLabel, KVRow, PulseDot, MetaTag, StatTile } from '../shared';

/**
 * OverviewTab — ApplicationDetailPage's "Overview" tab.
 *
 * Extracted from pages/ApplicationDetailPage.jsx — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §4 "god component" finding.
 */
export default function OverviewTab({
  app, ds, isCH1, isRunning, rStatus,
  replicas, replicaList, osEnabled, httpInbound, endpoints, ch2PrivateIPs,
}) {
  const statusAccent = isRunning ? 'emerald' : rStatus === 'FAILED' ? 'red' : rStatus === 'DEPLOYING' ? 'blue' : 'amber';
  const versionVal = isCH1 ? app.muleVersion : (ds.runtime?.version || ds.runtimeVersion);
  const versionSub = isCH1 ? app.region : (ds.runtime?.java ? `Java ${ds.runtime.java}` : (ds.runtime?.releaseChannel || undefined));
  const scaleVal = isCH1
    ? (app.workers?.amount != null ? `${app.workers.amount} worker${app.workers.amount === 1 ? '' : 's'}` : undefined)
    : (replicas != null ? `${replicas} replica${replicas === 1 ? '' : 's'}` : undefined);
  const scaleSub = isCH1
    ? (typeof app.workers?.type === 'string' ? app.workers.type : app.workers?.type?.name)
    : (app.application?.vCores != null ? `${app.application.vCores} vCores` : undefined);
  const lastMod = app.lastModifiedDate ? new Date(app.lastModifiedDate) : null;

  return (
    <div className="space-y-5">
      {/* ── Stat tiles — the handful of facts that matter most, at a glance ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile icon={Activity} label="Runtime Status" accent={statusAccent}
          value={rStatus || 'Unknown'} sub={isCH1 ? 'CloudHub 1.0' : 'CloudHub 2.0'} />
        <StatTile icon={GitBranch} label="Mule Runtime" accent="blue"
          value={versionVal || '—'} sub={versionSub} />
        <StatTile icon={Layers} label="Scale" accent="purple"
          value={scaleVal || '—'} sub={scaleSub} />
        <StatTile icon={Clock} label="Last Modified" accent="teal"
          value={lastMod ? lastMod.toLocaleDateString() : '—'} sub={lastMod ? lastMod.toLocaleTimeString() : undefined} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <GlassCard icon={Server} title="Deployment Details" accent="blue">
          {isCH1 ? (<>
            <SectionLabel icon={Hash}>Identity</SectionLabel>
            <KVRow label="App ID" value={app.id} mono />
            <KVRow label="Status" value={app.status} />
            <KVRow label="Region" value={app.region} mono />

            <SectionLabel icon={Boxes}>Network</SectionLabel>
            <KVRow label="Static IPs" value={app.staticIPsEnabled!=null?(app.staticIPsEnabled?'✅ Enabled':'❌ Disabled'):undefined} />
            {app.staticIPs && app.staticIPs.length > 0 && (
              <KVRow label="Static IP Addresses" value={app.staticIPs.join(', ')} mono />
            )}
          </>) : (<>
            <SectionLabel icon={Hash}>Runtime</SectionLabel>
            <KVRow label="Desired State" value={app.application?.desiredState} />
            <KVRow label="Deployment Status" value={app.status} />
            <KVRow label="Release Channel" value={ds.runtime?.releaseChannel} />

            <SectionLabel icon={Boxes}>Scaling & Network</SectionLabel>
            <KVRow label="Static IPs" value={ds.staticIpEnabled!=null?(ds.staticIpEnabled?'✅ Enabled':'❌ Disabled'):undefined} />
            {/* Private Space static outbound IPs */}
            {ch2PrivateIPs.length > 0 && (
              <KVRow label="Static Outbound IPs" value={ch2PrivateIPs.join(', ')} mono />
            )}
            {/* Replica IPs (shared space) */}
            {ch2PrivateIPs.length === 0 && replicaList.filter(r => r.ipAddress || r.publicIpAddress).length > 0 && (
              <KVRow label="Replica IPs" value={replicaList.filter(r => r.ipAddress || r.publicIpAddress).map(r => r.ipAddress || r.publicIpAddress).join(', ')} mono />
            )}
            <KVRow label="Update Strategy" value={typeof ds.updateStrategy==='string'?ds.updateStrategy:undefined} />

            <SectionLabel icon={Package}>Artifact</SectionLabel>
            <KVRow label="Artifact" value={app.application?.ref?`${app.application.ref.artifactId} v${app.application.ref.version}`:undefined} />
          </>)}
        </GlassCard>

        <GlassCard icon={Server} title="Replica Instances" count={replicaList.length} accent="purple">
          {replicaList.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {replicaList.map(r => {
                const ip = r.ipAddress || r.publicIpAddress;
                const active = r.state === 'STARTED' || r.state === 'RUNNING';
                return (
                  <div key={r.id} className="flex items-center gap-2.5 bg-gray-50/70 dark:bg-gray-800/40 border border-gray-200/60 dark:border-gray-700/50 rounded-xl px-3.5 py-3">
                    <PulseDot active={active} />
                    <div className="min-w-0 flex-1">
                      <p className="text-gray-700 dark:text-gray-200 text-xs font-mono truncate">{r.id}</p>
                      {ip && <p className="text-gray-400 dark:text-gray-500 text-[10px] font-mono truncate mt-0.5">{ip}</p>}
                    </div>
                    <MetaTag color={active?'green':'gray'}>{r.state}</MetaTag>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-gray-100 dark:bg-gray-800">
                <Server size={18} className="text-gray-400 dark:text-gray-500" />
              </div>
              <p className="text-gray-400 dark:text-gray-500 text-xs">No replica instances reported</p>
            </div>
          )}
        </GlassCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <GlassCard icon={Database} title="Object Store & Settings" accent="cyan">
          <KVRow label="Persistent Object Store" value={osEnabled?'✅ Enabled':'❌ Disabled'} />
          {isCH1 && <KVRow label="Persistent Queues" value={app.persistentQueues!=null?String(app.persistentQueues):undefined} />}
          {isCH1 && <KVRow label="Monitoring" value={app.monitoringEnabled!=null?String(app.monitoringEnabled):undefined} />}
          {isCH1 && <KVRow label="Custom Log4j" value={app.loggingCustomLog4JEnabled!=null?String(app.loggingCustomLog4JEnabled):undefined} />}
          {!isCH1 && <KVRow label="AM Log Forwarding" value={ds.disableAmLogForwarding!=null?String(!ds.disableAmLogForwarding):undefined} />}
        </GlassCard>

        {(httpInbound.publicUrl||endpoints.length>0) ? (
          <GlassCard icon={Globe} title="HTTP Endpoints" count={endpoints.length} accent="green" noPad>
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 space-y-1">
              {httpInbound.publicUrl && <KVRow label="Public URL" value={httpInbound.publicUrl} mono />}
              {httpInbound.internalUrl && <KVRow label="Internal URL" value={httpInbound.internalUrl} mono />}
              <KVRow label="Last Mile Security" value={httpInbound.lastMileSecurity!=null?String(httpInbound.lastMileSecurity):undefined} />
              <KVRow label="Forward SSL" value={httpInbound.forwardSslSession!=null?String(httpInbound.forwardSslSession):undefined} />
            </div>
            {endpoints.length>0 && (
              <table className="w-full text-sm border-collapse">
                <TableHeader><tr><th className="px-5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Access</th><th className="px-5 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">URL</th></tr></TableHeader>
                <tbody>
                  {endpoints.map((ep,i)=>(
                    <tr key={i} className="border-t border-gray-100 dark:border-gray-800 hover:bg-sf-50/40 dark:hover:bg-sf-500/5 transition-colors group">
                      <td className="px-5 py-3"><MetaTag color={ep.access==='external'?'blue':'gray'}>{ep.access}</MetaTag></td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-gray-600 dark:text-gray-300 text-xs font-mono break-all">{ep.url}</span>
                          <CopyBtn text={ep.url}/>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </GlassCard>
        ) : (
          <GlassCard icon={Globe} title="HTTP Endpoints" accent="green">
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-gray-100 dark:bg-gray-800">
                <Globe size={18} className="text-gray-400 dark:text-gray-500" />
              </div>
              <p className="text-gray-400 dark:text-gray-500 text-xs">No HTTP endpoints configured</p>
            </div>
          </GlassCard>
        )}
      </div>
    </div>
  );
}
