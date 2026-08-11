import { PairingModal } from './PairingModal'

export function PairingPage() {
  return <PairingModal isOpen onClose={() => { window.location.href = '/' }} />
}
