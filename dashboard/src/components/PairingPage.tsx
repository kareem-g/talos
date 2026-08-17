import { useNavigate } from 'react-router-dom'
import { PairingModal } from './PairingModal'

export function PairingPage() {
  const navigate = useNavigate()
  return <PairingModal isOpen onClose={() => navigate('/')} />
}
