import { getSetting } from '../db/sales'
import type { OutputReceiptStored, OutputStationKey } from '../types'
import { OUTPUT_STATION_ORDER } from './receiptFormat'
import {
  downloadTextFile,
  tryBluetoothPrintPlainBlocks,
  tryBluetoothPrintPlainText,
} from './bluetoothPrint'

const STATION_PRINT_KEY: Record<OutputStationKey, string> = {
  getraenke: 'printOutputBonGetraenke',
  kuchen_suess: 'printOutputBonKuchen',
  heisses_essen: 'printOutputBonHeiss',
}

export type CheckoutPrintBumps = {
  bumpCustomer: () => Promise<void>
  bumpOutput: (station: OutputStationKey) => Promise<void>
}

type PrintSegment = {
  text: string
  fileSlug: string
  bump?: () => Promise<void>
}

/**
 * Bondruck nach Verkauf: Kundenbon + optional bis zu drei Ausgabe-Bons (gleicher Drucker).
 * `skipAutoPrint`: Texte sind bereits gespeichert — kein automatischer Ausdruck.
 */
export async function printCheckoutReceiptsAfterSale(options: {
  customerText: string
  outputReceipts: OutputReceiptStored[]
  receiptNo: number
  skipAutoPrint: boolean
  bumps: CheckoutPrintBumps
}): Promise<{ printedAnything: boolean; hadFailure: boolean; message: string }> {
  if (options.skipAutoPrint) {
    return { printedAnything: false, hadFailure: false, message: '' }
  }
  const printC = (await getSetting('printCustomerReceipt')) !== '0'
  const masterOut = (await getSetting('printOutputBons')) !== '0'

  const segments: PrintSegment[] = []

  if (printC) {
    segments.push({
      text: options.customerText,
      fileSlug: 'kunde',
      bump: options.bumps.bumpCustomer,
    })
  }

  if (masterOut) {
    for (const st of OUTPUT_STATION_ORDER) {
      const enabled = (await getSetting(STATION_PRINT_KEY[st])) !== '0'
      if (!enabled) continue
      const entry = options.outputReceipts.find((e) => e.type === st)
      if (!entry?.text?.trim()) continue
      segments.push({
        text: entry.text,
        fileSlug:
          st === 'getraenke' ?
            'ausgabe-getraenke'
          : st === 'kuchen_suess' ?
            'ausgabe-kuchen'
          : 'ausgabe-essen',
        bump: async () => {
          await options.bumps.bumpOutput(st)
        },
      })
    }
  }

  if (segments.length === 0) {
    return { printedAnything: false, hadFailure: false, message: '' }
  }

  const fn = `dlrg-bon-${options.receiptNo}`

  if (segments.length === 1) {
    const one = segments[0]
    const res = await tryBluetoothPrintPlainText(one.text)
    if (res.ok) {
      if (one.bump) await one.bump()
      return { printedAnything: true, hadFailure: false, message: res.message }
    }
    downloadTextFile(`${fn}-${one.fileSlug}.txt`, one.text)
    return {
      printedAnything: false,
      hadFailure: true,
      message: `Bon konnte nicht gedruckt werden. ${res.message}`,
    }
  }

  const res = await tryBluetoothPrintPlainBlocks(segments.map((s) => s.text))
  if (res.ok) {
    for (const s of segments) {
      if (s.bump) await s.bump()
    }
    return { printedAnything: true, hadFailure: false, message: res.message }
  }
  segments.forEach((s, idx) =>
    downloadTextFile(`${fn}-${idx}-${s.fileSlug}.txt`, s.text),
  )
  return {
    printedAnything: false,
    hadFailure: true,
    message: `Bon konnte nicht gedruckt werden. ${res.message}`,
  }
}
