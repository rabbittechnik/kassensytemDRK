import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiBlob, apiJson } from '../api/http'
import { getStoredRole, hasApi } from '../api/config'
import { formatDateTime, formatMoney } from '../lib/format'
import { parseEurosToCents } from '../lib/euroParse'

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
  const apiLive = hasApi()
  const admin = apiLive && getStoredRole() === 'admin'


  const [evtOpen, setEvtOpen] = useState('')


  const [openRows, setOpenRows] = useState<ApiRow[]>([])


  const [invRows, setInvRows] = useState<ApiRow[]>([])


  const [events, setEvents] = useState<ApiRow[]>([])



  const [invStatus, setInvStatus] = useState('')
  const [invNo, setInvNo] = useState('')


  const [teamsDump, setTeamsDump] = useState<ApiRow[]>([])


  const [busy, setBusy] = useState(false)


  const [info, setInfo] = useState<string | null>(null)


  const [detailPick, setDetailPick] = useState<{ tid: string; eid: string } | null>(null)



  const [detailJson, setDetailJson] = useState<string>('')


  const [payInv, setPayInv] = useState<string | null>(null)



  const [payEu, setPayEu] = useState('')
  const [stInv, setStInv] = useState<string | null>(null)



  const [stWhy, setStWhy] = useState('')




  /** quick team */






  const [qn, setQn] = useState('')


  const [qe, setQe] = useState('')


  const [qa, setQa] = useState('')

  const [qContact, setQContact] = useState('')

  const [qPhone, setQPhone] = useState('')

  const [qDays, setQDays] = useState('14')

  const [qCustomerNo, setQCustomerNo] = useState('')

  const [qInternal, setQInternal] = useState('')

  const [qCc, setQCc] = useState('')

  const [qDept, setQDept] = useState('')

  const [qLocal, setQLocal] = useState('')




  const activeEvents = useMemo(




    () =>
      Array.isArray(events)
        ? events.filter((x) => String(x.status ?? '') === 'active')
        : [],




    [events],


  )




  


  const load = useCallback(async () => {


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


      const [op, iv, ev, tm] = await Promise.all([
        apiJson<ApiRow[]>(opensPath),




        apiJson<ApiRow[]>(invPath),




        apiJson<ApiRow[]>('/events'),

       admin ? apiJson<ApiRow[]>('/teams/all') : Promise.resolve([]),




      ])




      setOpenRows(Array.isArray(op) ? op : [])
      setInvRows(Array.isArray(iv) ? iv : [])


      setEvents(Array.isArray(ev) ? ev : [])



      setTeamsDump(Array.isArray(tm) ? tm : [])



    } catch (e) {




      setInfo(String((e as Error).message))



    } finally {




      setBusy(false)


    }


  }, [evtOpen, invNo, invStatus, admin])



  useEffect(() => {


    if (!apiLive)


      return


    queueMicrotask(() => {
      void load()
    })


  }, [apiLive, load])



  async function openDetail(teamId: string, eventId: string) {


    setDetailPick({ tid: teamId, eid: eventId })


    const rows = await apiJson(`/teams/${teamId}/open-sales?eventId=${eventId}`)
    setDetailJson(JSON.stringify(rows, null, 2))


  }



  async function collective(teamId: string, eventId: string) {


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



  async function quickTeam() {




    if (!admin || !qn.trim())


      return




    const pd = Number.parseInt(qDays.trim(), 10)
    const defaultPaymentDays =
      Number.isFinite(pd) && pd > 0 ? pd : 14

    await apiJson(`/teams`, {


      method: 'POST',




      body: JSON.stringify({
        name: qn.trim(),

        invoiceEmail: qe.trim(),

        contactName: qContact.trim(),

        phone: qPhone.trim(),

        billingAddress: qa.trim(),

        defaultPaymentDays,

        ...(qCustomerNo.trim() ? { customerNo: qCustomerNo.trim() } : {}),

        ...(qInternal.trim() ? { internalNote: qInternal.trim() } : {}),

        ...(qCc.trim() ? { costCenter: qCc.trim() } : {}),

        ...(qDept.trim() ? { department: qDept.trim() } : {}),

        ...(qLocal.trim() ? { localGroup: qLocal.trim() } : {}),
      }),




    })


    setQn('')
    setQe('')
    setQa('')
    setQContact('')
    setQPhone('')
    setQDays('14')
    setQCustomerNo('')
    setQInternal('')
    setQCc('')
    setQDept('')
    setQLocal('')


    await load()


  }



  async function dlPdf(invId: string, no: string) {




    const blob = await apiBlob(`/invoices/${invId}/pdf`)


    saveBlob(blob, `rechnung-${no}.pdf`)


  }



  async function mail(invId: string) {




    if (!admin)



      return




    await apiJson(`/invoices/${invId}/email`, {
      method: 'POST',




      body: JSON.stringify({}),


    })




    setInfo('Mail versendet (falls SMTP aktiv).')


  }






  async function payGo() {


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


    if (!admin || !stInv || !stWhy.trim())


      return




    await apiJson(`/invoices/${stInv}/storno`, {


      method: 'POST',




      body: JSON.stringify({ reason: stWhy.trim() }),



    })


    setStInv(null)


    setStWhy('')
    await load()


  }






  if (!apiLive)


    return (


      <p className="text-sm text-neutral-400">
        Für diesen Bereich bitte{' '}


        <code className="text-cyan-200">VITE_API_BASE_URL</code> konfigurieren und anmelden.



      </p>



    )





  return (




    <div className="space-y-10 pb-20">





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






      {admin && (




        <div className="rounded-xl border border-white/10 bg-black/30 p-4">





          <h3 className="font-bold text-white">Neues Vereins‑/Team‑Konto</h3>



          <p className="mt-2 text-xs text-neutral-400">
            Stammdaten werden in der Datenbank gespeichert und stehen später in der Kasse unter „Auf Rechnung“ zur Auswahl.
          </p>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <input placeholder="Name *" className="rounded-lg border border-white/15 bg-neutral-950 px-3 py-2 md:col-span-2" value={qn} onChange={(e) => setQn(e.target.value)} />
            <input type="email" placeholder="Rechnungs‑E‑Mail" className="rounded-lg border border-white/15 bg-neutral-950 px-3 py-2" value={qe} onChange={(e) => setQe(e.target.value)} />
            <input placeholder="Telefon" className="rounded-lg border border-white/15 bg-neutral-950 px-3 py-2" value={qPhone} onChange={(e) => setQPhone(e.target.value)} />
            <input placeholder="Ansprechpartner/in" className="rounded-lg border border-white/15 bg-neutral-950 px-3 py-2 md:col-span-2" value={qContact} onChange={(e) => setQContact(e.target.value)} />
            <textarea placeholder="Rechnungsanschrift" rows={2} className="resize-y rounded-lg border border-white/15 bg-neutral-950 px-3 py-2 md:col-span-2" value={qa} onChange={(e) => setQa(e.target.value)} />
            <input inputMode="numeric" placeholder="Zahlungsziel (Tage)" className="rounded-lg border border-white/15 bg-neutral-950 px-3 py-2" value={qDays} onChange={(e) => setQDays(e.target.value)} />
            <input placeholder="Kunden‑Nr." className="rounded-lg border border-white/15 bg-neutral-950 px-3 py-2" value={qCustomerNo} onChange={(e) => setQCustomerNo(e.target.value)} />
            <input placeholder="Kostenstelle" className="rounded-lg border border-white/15 bg-neutral-950 px-3 py-2" value={qCc} onChange={(e) => setQCc(e.target.value)} />
            <input placeholder="Abteilung" className="rounded-lg border border-white/15 bg-neutral-950 px-3 py-2" value={qDept} onChange={(e) => setQDept(e.target.value)} />
            <input placeholder="Ortsgruppe" className="rounded-lg border border-white/15 bg-neutral-950 px-3 py-2 md:col-span-2" value={qLocal} onChange={(e) => setQLocal(e.target.value)} />
            <input placeholder="Interne Notiz" className="rounded-lg border border-white/15 bg-neutral-950 px-3 py-2 md:col-span-2" value={qInternal} onChange={(e) => setQInternal(e.target.value)} />
            <button type="button" className="rounded-lg bg-blue-900/70 px-4 py-2 font-bold text-white disabled:opacity-40 md:col-span-2" disabled={!qn.trim()} onClick={() => void quickTeam()}>
              Team anlegen
            </button>
          </div>



        </div>




      )}
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



                        {admin && (




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



                      {admin && (




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



      {/* team dump */}
      <section>



        <h4 className="font-bold text-white">Alle Teams




        </h4>



        <div className="mt-3 max-h-48 overflow-auto text-[11px] text-neutral-300">





          {teamsDump.map((t) => {




            return (




              <div key={String(t.id)} className="border-b border-white/5 py-1">





                #{String(t.id)} • {String(t.name)}




              </div>





            )






          })}
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


