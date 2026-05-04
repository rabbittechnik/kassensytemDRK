import { getSetting } from '../db/sales'
import {
  downloadTextFile,
  tryBluetoothPrintPlainSequence,
  tryBluetoothPrintPlainText,
} from './bluetoothPrint'

export type DualPrintBump = {
  bumpCustomer: () => Promise<void>
  bumpServing: () => Promise<void>
}

/**
 * Bondruck nach Verkauf (Einstellungen: Kundenbon / Servierbon).
 * `skipAutoPrint`: z. B. lokaler Schnellabschluss ohne Druck — Texte sind trotzdem schon gespeichert.
 */
export async function printDualReceiptsAfterSale(options: {
  customerText: string
  servingText: string
  receiptNo: number
  skipAutoPrint: boolean
  bumps: DualPrintBump
}): Promise<{ printedAnything: boolean; hadFailure: boolean; message: string }> {
  if (options.skipAutoPrint) {
    return { printedAnything: false, hadFailure: false, message: '' }
  }
  const printC = (await getSetting('printCustomerReceipt')) !== '0'
  const printS = (await getSetting('printServingReceipt')) !== '0'
  if (!printC && !printS) {
    return { printedAnything: false, hadFailure: false, message: '' }
  }

  const fn = `dlrg-bon-${options.receiptNo}`

  if (printC && printS) {
    const res = await tryBluetoothPrintPlainSequence(options.customerText, options.servingText)
    if (res.ok) {
      await options.bumps.bumpCustomer()
      await options.bumps.bumpServing()
      return { printedAnything: true, hadFailure: false, message: res.message }
    }
    downloadTextFile(`${fn}-kunde.txt`, options.customerText)
    downloadTextFile(`${fn}-servier.txt`, options.servingText)
    return {
      printedAnything: false,
      hadFailure: true,
      message: `Bon konnte nicht gedruckt werden. ${res.message}`,
    }
  }

  if (printC) {
    const res = await tryBluetoothPrintPlainText(options.customerText)
    if (res.ok) {
      await options.bumps.bumpCustomer()
      return { printedAnything: true, hadFailure: false, message: res.message }
    }
    downloadTextFile(`${fn}-kunde.txt`, options.customerText)
    return {
      printedAnything: false,
      hadFailure: true,
      message: `Bon konnte nicht gedruckt werden. ${res.message}`,
    }
  }

  const res = await tryBluetoothPrintPlainText(options.servingText)
  if (res.ok) {
    await options.bumps.bumpServing()
    return { printedAnything: true, hadFailure: false, message: res.message }
  }
  downloadTextFile(`${fn}-servier.txt`, options.servingText)
  return {
    printedAnything: false,
    hadFailure: true,
    message: `Bon konnte nicht gedruckt werden. ${res.message}`,
  }
}
