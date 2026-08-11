import { useState } from 'react'
import { Shield, AlertTriangle, Check, X, Infinity as InfinityIcon } from 'lucide-react'

interface ApprovalRequest {
  id: string
  prompt: string
  options: string[]
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
}

interface ApprovalCardProps {
  request: ApprovalRequest
  onApprove?: (id: string, always: boolean) => void
  onReject?: (id: string) => void
}

const riskConfig = {
  low: { color: 'text-success', bg: 'bg-success/10', border: 'border-success/20', icon: Shield },
  medium: { color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/20', icon: AlertTriangle },
  high: { color: 'text-error', bg: 'bg-error/10', border: 'border-error/20', icon: AlertTriangle },
  critical: { color: 'text-error', bg: 'bg-error/20', border: 'border-error/30', icon: AlertTriangle },
}

export function ApprovalCard({ request, onApprove, onReject }: ApprovalCardProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const config = riskConfig[request.riskLevel]
  const RiskIcon = config.icon

  return (
    <div className={`m-4 rounded-lg border ${config.border} ${config.bg} overflow-hidden`}>
      {/* Header */}
      <div 
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <RiskIcon className={`w-5 h-5 ${config.color}`} />
        <div className="flex-1">
          <h4 className="text-sm font-medium text-text">Approval Required</h4>
          <p className="text-xs text-text-muted mt-0.5">Risk level: <span className={config.color}>{request.riskLevel}</span></p>
        </div>
        <span className="text-[10px] text-text-dim font-mono">{request.id.slice(0, 8)}</span>
      </div>

      {/* Body */}
      {isExpanded && (
        <>
          <div className="px-4 pb-3">
            <p className="text-sm text-text leading-relaxed">{request.prompt}</p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 px-4 pb-4">
            <button
              onClick={() => onApprove?.(request.id, false)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-success/20 hover:bg-success/30 text-success text-sm font-medium transition-colors"
            >
              <Check className="w-4 h-4" />
              <span>Yes</span>
            </button>
            <button
              onClick={() => onApprove?.(request.id, true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-accent/20 hover:bg-accent/30 text-accent text-sm font-medium transition-colors"
            >
              <InfinityIcon className="w-4 h-4" />
              <span>Always</span>
            </button>
            <button
              onClick={() => onReject?.(request.id)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-error/20 hover:bg-error/30 text-error text-sm font-medium transition-colors"
            >
              <X className="w-4 h-4" />
              <span>No</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
