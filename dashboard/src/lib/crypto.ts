export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )
}

export async function signData(privateKey: CryptoKey, data: string): Promise<string> {
  const encoder = new TextEncoder()
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoder.encode(data)
  )
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
}

export async function verifySignature(
  publicKey: CryptoKey,
  data: string,
  signature: string
): Promise<boolean> {
  const encoder = new TextEncoder()
  const sigBuffer = Uint8Array.from(atob(signature), c => c.charCodeAt(0))
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    sigBuffer,
    encoder.encode(data)
  )
}
