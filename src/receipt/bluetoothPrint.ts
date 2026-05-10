import {
  buildEscPosBytes,
  buildEscPosPlainText,
  buildEscPosPlainTextBlocks,
  type ReceiptPayload,
} from './escpos'

export interface BluetoothPrintResult {
  ok: boolean
  message: string
}

async function sendEscPosBytes(bytes: Uint8Array): Promise<BluetoothPrintResult> {
  if (!navigator.bluetooth?.requestDevice) {
    return {
      ok: false,
      message:
        'Web Bluetooth nicht verfügbar (HTTPS, Chrome/Edge auf Desktop/Android). Bon kann kopiert oder als Datei gespeichert werden.',
    }
  }

  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [],
    })
    const server = await device.gatt?.connect()
    if (!server) {
      return { ok: false, message: 'GATT-Verbindung fehlgeschlagen.' }
    }

    const services = await server.getPrimaryServices()
    for (const service of services) {
      const chars = await service.getCharacteristics()
      for (const ch of chars) {
        const props = ch.properties
        if (props.write || props.writeWithoutResponse) {
          const chunkSize = 100
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const part = bytes.slice(i, i + chunkSize)
            if (props.writeWithoutResponse) {
              await ch.writeValueWithoutResponse(part)
            } else {
              await ch.writeValueWithResponse(part)
            }
          }
          device.gatt?.disconnect()
          return { ok: true, message: 'Bon wurde gesendet.' }
        }
      }
    }

    device.gatt?.disconnect()
    return {
      ok: false,
      message:
        'Keine schreibbare Bluetooth-Charakteristik gefunden. Druckerprofil prüfen oder Text-Bon nutzen.',
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('cancel') || msg.includes('User')) {
      return { ok: false, message: 'Auswahl abgebrochen.' }
    }
    return { ok: false, message: msg }
  }
}

/**
 * Web Bluetooth: Bondrucker sprechen oft GATT (z. B. HM-10/seriell-GATT-Adapter oder native BLE-Drucker).
 * Geräte unterscheiden sich stark – hier: alle Services durchsuchen und erste schreibbare Charakteristik nutzen.
 */
export async function tryBluetoothPrint(
  payload: ReceiptPayload,
): Promise<BluetoothPrintResult> {
  return sendEscPosBytes(buildEscPosBytes(payload))
}

/** Ein vorgeformter Text-Bon (Kunden- oder Servierbon). */
export async function tryBluetoothPrintPlainText(text: string): Promise<BluetoothPrintResult> {
  return sendEscPosBytes(buildEscPosPlainText(text, true))
}

/** Kunden- und Servierbon in einem Bluetooth-Gang (ein Gerät wählen). */
export async function tryBluetoothPrintPlainSequence(
  customerText: string,
  servingText: string,
): Promise<BluetoothPrintResult> {
  return sendEscPosBytes(buildEscPosPlainTextBlocks([customerText, servingText], true))
}

/** Beliebig viele Bons (Kunde + Stations-Ausgaben) mit einem Auftrag/einem Gerät. */
export async function tryBluetoothPrintPlainBlocks(
  blocks: string[],
): Promise<BluetoothPrintResult> {
  if (blocks.length === 0)
    return { ok: false, message: 'Keine Druckdaten.' }
  if (blocks.length === 1) return tryBluetoothPrintPlainText(blocks[0])
  return sendEscPosBytes(buildEscPosPlainTextBlocks(blocks, true))
}

export function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
