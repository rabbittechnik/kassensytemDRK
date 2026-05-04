import { useCallback, useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import { apiBlob, apiJson } from '../api/http'
import { getStoredRole, getStoredToken } from '../api/config'
import { formatDateTime, formatMoney } from '../lib/format'
import { parseEurosToCents } from '../lib/euroParse'
import { TeamsManagement } from './TeamsManagement'
import {
  buildDemoOpenPostRows,
  createDemoCollectiveInvoice,
  updateDemoInvoice,
  useDemoInvoices,
  useDemoMode,
  useDemoSales,
  useDemoTeams,
} from '../demo/demoStore'

type ApiRow = Record<string, unknown>

function saveBlob(blob: Blob, fn: string) {
  const u = URL.createObjectURL(blob)

  const a = document.createElement('a')


  a.href = u




  a.download = fn




  document.body.append(a)



  a.click()



  a.remove()




  URL.revokeObjectURL(u)

}







export function TeamsBilling() {
  const demoMode = useDemoMode()
  const demoSales = useDemoSales()
  const demoTeams = useDemoTeams()
  const demoInvoices = useDemoInvoices()
  const [authRev, setAuthRev] = useState(0)
  const admin = Boolean(getStoredToken()) && getStoredRole() === 'admin'
  const allowBillingAdmin = admin || demoMode

  const [evtOpen, setEvtOpen] = useState('')


  const [openRows, setOpenRows] = useState<ApiRow[]>([])


  const [invRows, setInvRows] = useState<ApiRow[]>([])


  const [events, setEvents] = useState<ApiRow[]>([])



  const [invStatus, setInvStatus] = useState('')
  const [invNo, setInvNo] = useState('')


  const [busy, setBusy] = useState(false)


  const [info, setInfo] = useState<string | null>(null)


  const [detailPick, setDetailPick] = useState<{ tid: string; eid: string } | null>(null)



  const [detailJson, setDetailJson] = useState<string>('')


  const [payInv, setPayInv] = useState<string | null>(null)



  const [payEu, setPayEu] = useState('')
  const [stInv, setStInv] = useState<string | null>(null)



  const [stWhy, setStWhy] = useState('')

  const activeEvents = useMemo(




    () =>
      Array.isArray(events)
        ? events.filter((x) => String(x.status ?? '') === 'active')
        : [],




    [events],


  )




  


  const load = useCallback(async () => {
    if (demoMode) {
      setBusy(true)
      setInfo(null)
      try {
        let opens = buildDemoOpenPostRows(demoSales, demoTeams)
        if (evtOpen.trim()) {
          const eid = evtOpen.trim()
          opens = opens.filter((r) => String(r.eventId) === eid)
        }
        setOpenRows(opens)

        let invs: ApiRow[] = demoInvoices.map((inv) => ({
          id: inv.id,
          invoice_no: inv.invoice_no,
          total_cents: inv.total_cents,
          created_at: inv.created_at,
          derivedStatus: inv.derivedStatus,
        }))
        if (invStatus.trim()) {
          const q = invStatus.trim().toLowerCase()
          invs = invs.filter((r) =>
            String(r.derivedStatus ?? '')
              .toLowerCase()
              .includes(q),
          )
        }
        if (invNo.trim()) {
          const q = invNo.trim().toLowerCase()
          invs = invs.filter((r) =>
            String(r.invoice_no ?? '')
              .toLowerCase()
              .includes(q),
          )
        }
        setInvRows(invs)

        const eventIdSet = new Set<string>(['demo-event'])
        for (const s of demoSales) {
          if (s.eventId) eventIdSet.add(s.eventId)
        }
        const evRows: ApiRow[] = []
        for (const eid of eventIdSet) {
          const name =
            eid === 'demo-event'
              ? 'DEMO-Veranstaltung'
              : demoSales.find((s) => s.eventId === eid)?.eventName ?? eid
          evRows.push({ id: eid, name, status: 'active' })
        }
        evRows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'))
        setEvents(evRows)
      } finally {
        setBusy(false)
      }
      return
    }

    setBusy(true)


    setInfo(null)



    try {


      let opensPath = `/invoice-open-posts`


      if (evtOpen.trim())


        opensPath += `?eventId=${encodeURIComponent(evtOpen.trim())}`


      const qs = new URLSearchParams()


      if (invStatus.trim()) qs.set('status', invStatus.trim())


      if (invNo.trim()) qs.set('invoiceNo', invNo.trim())




      const invPath =
        `/invoices/list${qs.toString().length ? `?${qs}` : ''}`


      const tok = getStoredToken()
      if (!tok) {
        setOpenRows([])
        setInvRows([])
        setEvents([])
        return
      }

      const [op, iv, ev] = await Promise.all([
        apiJson<ApiRow[]>(opensPath),




        apiJson<ApiRow[]>(invPath),




        apiJson<ApiRow[]>('/events'),





      ])




      setOpenRows(Array.isArray(op) ? op : [])
      setInvRows(Array.isArray(iv) ? iv : [])


      setEvents(Array.isArray(ev) ? ev : [])



    } catch (e) {




      setInfo(String((e as Error).message))



    } finally {




      setBusy(false)


    }


  }, [
    evtOpen,
    invNo,
    invStatus,
    authRev,
    demoMode,
    demoSales,
    demoTeams,
    demoInvoices,
  ])

  useEffect(() => {
    const fn = () => setAuthRev((x) => x + 1)
    window.addEventListener('drk-kasse-auth', fn)
    return () => window.removeEventListener('drk-kasse-auth', fn)
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void load()
    })
  }, [load])



  async function openDetail(teamId: string, eventId: string) {
    setDetailPick({ tid: teamId, eid: eventId })

    if (demoMode) {
      const rows = demoSales.filter(
        (s) =>
          s.paymentMethod === 'invoice' &&
          s.teamId === teamId &&
          s.eventId === eventId &&
          !s.demoInvoiceAllocationId,
      )
      setDetailJson(
        JSON.stringify(
          rows.map((s) => ({
            bonNumber: s.bonNumberLabel,
            createdAt: s.createdAt,
            totalCents: s.totalCents,
            lines: s.lines,
            contactName: s.contactName,
            note: s.note,
          })),
          null,
          2,
        ),
      )
      return
    }

    const rows = await apiJson(`/teams/${teamId}/open-sales?eventId=${eventId}`)
    setDetailJson(JSON.stringify(rows, null, 2))
  }



  async function collective(teamId: string, eventId: string) {
    if (demoMode) {
      const inv = createDemoCollectiveInvoice(teamId, eventId)
      if (!inv) {
        setInfo('DEMO: Keine offenen Rechnungsverkäufe für dieses Team / diese Veranstaltung.')
        return
      }
      setInfo(
        `DEMO: Sammelrechnung ${inv.invoice_no} erstellt (${formatMoney(inv.total_cents)}).`,
      )
      await load()
      return
    }

    if (!admin) return


    await apiJson(`/invoices/collective`, {


      method: 'POST',




      body: JSON.stringify({
        teamId,


        eventId,







        attachReceiptDetails: false,



      }),




    })


    setInfo('Rechnung erstellt.')




    await load()






  }



  async function dlPdf(invId: string, no: string) {
    if (demoMode) {
      const inv = demoInvoices.find((i) => i.id === invId)
      if (!inv) {
        setInfo('DEMO: Rechnung nicht gefunden.')
        return
      }
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      doc.setFontSize(16)
      doc.text('DLRG Kasse – DEMO-Rechnung', 20, 24)
      doc.setFontSize(11)
      doc.text(`Nr. ${no}`, 20, 34)
      doc.text(`Team: ${inv.teamName}`, 20, 42)
      doc.text(`Veranstaltung: ${inv.eventName}`, 20, 49)
      doc.text(`Betrag: ${formatMoney(inv.total_cents)}`, 20, 56)
      doc.text('Hinweis: Nur Simulation, keine steuerliche Relevanz.', 20, 68)
      const safeNo = no.replace(/[^a-zA-Z0-9_-]/g, '_')
      doc.save(`demo-rechnung-${safeNo}.pdf`)
      setInfo('DEMO: PDF heruntergeladen.')
      return
    }

    const blob = await apiBlob(`/invoices/${invId}/pdf`)


    saveBlob(blob, `rechnung-${no}.pdf`)


  }



  async function mail(invId: string) {
    if (demoMode) {
      const inv = demoInvoices.find((i) => i.id === invId)
      const team = inv ? demoTeams.find((t) => t.id === inv.teamId) : undefined
      const email = team?.invoiceEmail?.trim() || '—'
      setInfo(`DEMO: E-Mail würde an ${email} gesendet (kein SMTP).`)
      return
    }

    if (!admin) return




    await apiJson(`/invoices/${invId}/email`, {
      method: 'POST',




      body: JSON.stringify({}),


    })




    setInfo('Mail versendet (falls SMTP aktiv).')


  }






  async function payGo() {
    if (demoMode) {
      if (!payInv) return
      updateDemoInvoice(payInv, { derivedStatus: 'PAID' })
      setPayInv(null)
      setPayEu('')
      setInfo('DEMO: Zahlung als verbucht markiert.')
      await load()
      return
    }

    if (!payInv)



      return






    const c = parseEurosToCents(payEu)



    if (!c)



      return






    await apiJson(`/invoices/${payInv}/payments`, {


      method: 'POST',




      body: JSON.stringify({ amountCents: c, paidAt: Date.now() }),


    })


    setPayInv(null)




    setPayEu('')
    await load()


  }






  async function stGo() {
    if (demoMode) {
      if (!stInv || !stWhy.trim()) return
      updateDemoInvoice(stInv, { derivedStatus: 'STORNO' })
      setStInv(null)
      setStWhy('')
      setInfo('DEMO: Rechnung als storniert markiert.')
      await load()
      return
    }

    if (!admin || !stInv || !stWhy.trim()) return




    await apiJson(`/invoices/${stInv}/storno`, {


      method: 'POST',




      body: JSON.stringify({ reason: stWhy.trim() }),



    })


    setStInv(null)


    setStWhy('')
    await load()


  }






  return (




    <div className="space-y-10 pb-20">
      <TeamsManagement onTeamsChanged={() => void load()} />

      {demoMode && (
        <div className="rounded-xl border-2 border-yellow-400/60 bg-yellow-950/15 px-4 py-3 text-sm font-bold text-yellow-100">
          DEMO-Modus aktiv – Rechnungs- und Mahn-Aktionen sind deaktiviert. Es
          werden keine echten Sammelrechnungen erstellt, keine E-Mails versendet,
          keine Zahlungen verbucht und keine Stornos erzeugt.
        </div>
      )}

      <div className="flex flex-wrap gap-4">





        <button


          type="button"




          disabled={busy}




          className="rounded-lg border border-cyan-500/40 px-4 py-2 text-sm font-bold text-cyan-200"


          onClick={() => void load()}




        >
          Aktualisieren



        </button>



        {info && <span className="text-sm text-amber-200">{info}</span>}


      </div>
      {/* offene */}
      <section>



        <h3 className="font-bold text-[#FFD700]">

          Offene Teamrechnungen



        </h3>



        <div className="mt-2 flex flex-wrap gap-3">




          <select






            className="rounded-lg border border-white/15 bg-neutral-950 px-3 py-2 text-white"


            value={evtOpen}






            onChange={(e) => {


              setEvtOpen(e.target.value)




            }}




          >




            <option value="">Alle Events</option>


            {activeEvents.map((e) => (






              <option key={String(e.id)} value={String(e.id)}>



                {String(e.name)}






              </option>




            ))}




          </select>



        </div>




        <div className="mt-4 overflow-auto">





          <table className="w-full min-w-[960px] text-left text-[11px]">





            <thead className="uppercase tracking-wide text-neutral-500">





              <tr>





                <th className="py-2">Team</th>



                <th className="py-2">



                  Event




                </th>



                <th className="py-2">

                  Ø


                </th>



                <th className="py-2">

                  Σ






                </th>



                <th className="py-2">

                  Datum






                </th>



                <th />
              </tr>




            </thead>






            <tbody>



              {openRows.map((r, i) => {


                const tid = String(r.teamId ?? r.team_id ?? '')



                const eid =




                  String(r.eventId ?? r.event_id ?? '')



                const tnm =
                  String(r.teamName ?? r.team_name ?? '—')


                const enm =
                  String(r.eventName ?? r.event_name ?? '—')


                const cnt =
                  Number(r.openCount ?? r.open_count ?? 0)


                const cents =
                  Number(r.totalOpenCents ?? r.total_open_cents ?? 0)


                const a = Number(r.firstPurchaseAt ?? 0)


                const b = Number(r.lastPurchaseAt ?? 0)


                return (



                  <tr key={`${tid}_${i}`} className="border-t border-white/10">





                    <td className="py-3 font-semibold text-white">{tnm}




                    </td>





                    <td className="py-3">

                      {enm}



                    </td>





                    <td className="py-3 tabular-nums">

                      {cnt}



                    </td>






                    <td className="py-3 tabular-nums text-[#FFD700]">



                      {formatMoney(cents)}






                    </td>





                    <td className="py-3 text-neutral-400">{


                      `${a ? formatDateTime(a) : '?'} ⇢ ${




                        b ? formatDateTime(b) : '?'





                      }`



                    }</td>



                    <td className="py-3">




                      <div className="flex flex-wrap gap-2">





                        <button






                          type="button"






                          className="rounded-lg border border-cyan-500/40 px-3 py-1 text-[10px] font-bold uppercase text-cyan-200"


                          onClick={() => void openDetail(tid, eid)}




                        >
                          Details






                        </button>



                        {allowBillingAdmin && (




                          <button






                            type="button"






                            className="rounded-lg border border-[#FFD700]/50 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-[#FFD700]"
                            onClick={() => void collective(tid, eid)}




                          >
                            Sammelrechnung




                          </button>




                        )}



                      </div>



                    </td>



                  </tr>



                )


              })}
            </tbody>



          </table>



        </div>


      </section>



      {/* detail */}
      {detailPick && detailJson ? (




        <div className="rounded-xl border border-cyan-500/30 bg-neutral-950/60 p-4">





          <button






            type="button"




            className="float-right text-xs text-neutral-500"


            onClick={() => {


              setDetailPick(null)


              setDetailJson('')


            }}




          >




            schließen



          </button>



          <pre className="mt-10 max-h-96 overflow-auto text-[11px] text-neutral-200">



            {detailJson}






          </pre>



        </div>



      ) : null}



      {/* Rechnungen */}
      <section>



        <h3 className="font-bold text-[#FFD700]">Rechnungsarchiv




        </h3>



        <div className="mt-3 flex gap-3">





          <select






            value={invStatus}




            onChange={(e) => setInvStatus(e.target.value)}
            className="rounded-lg border border-white/15 bg-neutral-950 px-3 py-2 text-white"


          >
            <option value="">Status‑Filter




            </option>


            {[

              `open`,
              `sent`,


              `partially_paid`,


              `paid`,




              `cancelled`,




            ].map((s) => (






              <option key={s} value={s}>



                {s}






              </option>




            ))}




          </select>



          <input



            placeholder='Nr. enthält …'


            value={invNo}



            onChange={(e) => setInvNo(e.target.value)}
            className="rounded-lg border border-white/15 bg-neutral-950 px-3 py-2 text-white"


          />



        </div>



        <div className="mt-4 overflow-auto">





          <table className="w-full min-w-[760px] text-left text-[11px]">




            <thead className="text-neutral-500">





              <tr>





                <th className="py-2">

                  Nr.




                </th>





                <th className="py-2">





                  Datum



                </th>





                <th className="py-2">





                  Σ






                </th>






                <th className="py-2">





                  Status




                </th>






                <th />




              </tr>



            </thead>




            <tbody>



              {invRows.map((inv) => {




                const id = String(inv.id)




                const no =




                  String(inv.invoice_no ?? inv.invoiceNo ?? id)



                const tot =
                  Number(inv.total_cents ?? 0)


                const st =
                  String(inv.derivedStatus ?? inv.status)



                const cr =
                  Number(inv.created_at ?? inv.createdAt ?? 0)


                return (



                  <tr key={id} className="border-t border-white/10">





                    <td className="py-3 font-semibold">{no}




                    </td>





                    <td className="py-3 text-neutral-400">





                      {cr ? `${formatDateTime(cr)}`




                        :




                        ''




                      }




                    </td>






                    <td className="py-3 tabular-nums">{formatMoney(tot)}






                    </td>





                    <td className="py-3">{st}






                    </td>



                    <td className="py-3">





                      <button






                        type="button"




                        className="mr-1 rounded border px-2 py-1 text-[9px]"
                        onClick={() => void dlPdf(id, no)}




                      >
                        PDF






                      </button>



                      {allowBillingAdmin && (




                        <>
                          <button




                            type="button"




                            className="mr-1 rounded border px-2 py-1 text-[9px]"
                            onClick={() => void mail(id)}




                          >
                            Mail






                          </button>




                          <button




                            type="button"




                            className="mr-1 rounded border px-2 py-1 text-[9px]"
                            onClick={() => {




                              setPayInv(id)



                              setPayEu('')






                            }}




                          >
                            Zahlung




                          </button>




                          <button




                            type="button"




                            className="mr-1 rounded border border-red-900/70 px-2 py-1 text-[9px] text-red-400"


                            onClick={() => {


                              setStInv(id)



                            }}




                          >




                            ST






                          </button>






                          <button




                            type="button"




                            className="rounded border px-2 py-1 text-[9px]"
                            onClick={async () => {


                              if (demoMode) {
                                const inv = demoInvoices.find((i) => i.id === id)
                                if (!inv) {
                                  setInfo('DEMO: Rechnung nicht gefunden.')
                                  return
                                }
                                const lines = demoSales.filter(
                                  (s) => s.demoInvoiceAllocationId === id,
                                )
                                const blob = new Blob(
                                  [
                                    JSON.stringify(
                                      {
                                        demo: true,
                                        invoice: inv,
                                        sales: lines.map((s) => ({
                                          bon: s.bonNumberLabel,
                                          totalCents: s.totalCents,
                                          lines: s.lines,
                                        })),
                                      },
                                      null,
                                      2,
                                    ),
                                  ],
                                  { type: 'application/json' },
                                )
                                saveBlob(blob, `structured-${no}-DEMO.json`)
                                setInfo('DEMO: Strukturierter Export (JSON) heruntergeladen.')
                                return
                              }

                              const blob = await apiBlob(
                                `/invoices/${id}/structured-export`,
                              )

                              saveBlob(blob, `structured-${no}.json`)






                            }}




                          >




                            XML‑Vorb.



                          </button>




                        </>



                      )}



                    </td>



                  </tr>



                )


              })}
            </tbody>



          </table>



        </div>


      </section>
      {payInv && admin ? (




        <div className="fixed inset-0 z-[90] bg-black/80 p-8">





          <div className="mx-auto mt-40 max-w-sm rounded-xl border border-white/20 bg-neutral-950 p-6">





            <label className="text-sm text-neutral-400">EUR






              <input






                className="mt-2 w-full rounded-lg bg-black px-3 py-3 text-white"


                autoFocus




                value={payEu}




                onChange={(e) => setPayEu(e.target.value)}




              />




            </label>



            <div className="mt-4 flex gap-2">





              <button






                type="button"




                className="flex-1 border py-3 text-neutral-300"


                onClick={() => {


                  setPayInv(null)



                }}




              >




                Abort






              </button>




              <button






                type="button"




                className="flex-1 bg-green-800 py-3 font-black text-white"
                onClick={() => void payGo()}




              >
                OK






              </button>




            </div>




          </div>





        </div>




      ) : null}




      {stInv && admin ? (





        <div className="fixed inset-0 z-[90] bg-black/85 p-6">





          <div className="mx-auto mt-36 max-w-md rounded-xl bg-neutral-950 p-8">





            <textarea






              placeholder="Pflichtgrund"




              rows={6}






              className="mt-6 w-full bg-black px-3 py-3 text-white"


              value={stWhy}




              onChange={(e) => setStWhy(e.target.value)}
            />



            <div className="mt-4 flex gap-2">




              <button






                type="button"




                className="flex-1 border py-3 text-neutral-300"


                onClick={() => {


                  setStInv(null)



                }}




              >




                Abbrechen






              </button>




              <button






                type="button"




                className="flex-1 bg-red-950 py-3 font-black text-white"


                disabled={!stWhy.trim()}


                onClick={() => void stGo()}




              >
                Storno erstellen




              </button>




            </div>




          </div>




        </div>




      ) : null}




    </div>




  )



}


