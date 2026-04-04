(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push(["object" == typeof document ? document.currentScript : void 0, 400389, e => {
    "use strict";
    var t = e.i(490578);
    e.s(["useTranscriptLanguagePreference", 0, function() {
        let[e,a] = (0,
        t.useSessionstorageState)("transcript_language_preference", null);
        return {
            transcriptLanguage: e?.language || null,
            setTranscriptLanguage: e => {
                a({
                    language: e,
                    timestamp: Date.now()
                })
            }
            ,
            getTranscriptLanguage: () => e?.language || null,
            clearTranscriptLanguage: () => {
                a(null)
            }
        }
    }
    ])
}
, 821067, e => {
    "use strict";
    var t = e.i(268601)
      , a = e.i(944967);
    e.i(555935);
    var s = e.i(258281);
    e.s(["default", 0, ({src: e="", alt: r="", imgWidth: l, hasBackgroundColor: n=!0, className: i}) => (0,
    t.jsx)("div", {
        className: i,
        children: (0,
        t.jsx)(s.default, {
            alt: r,
            src: e,
            height: l,
            width: l,
            className: (0,
            a.default)("size-full rounded-full object-cover object-center", {
                "bg-[#717171]": n
            }),
            sizes: "200px"
        })
    })])
}
, 624063, e => {
    "use strict";
    var t = e.i(268601)
      , a = e.i(975705)
      , s = e.i(944967);
    e.i(965567);
    var r = e.i(764107)
      , l = e.i(458325);
    e.i(733953);
    var n = e.i(769343);
    e.i(692225);
    var i = e.i(724410)
      , o = e.i(114369)
      , c = e.i(77925)
      , d = e.i(671096);
    class u {
        constructor() {
            this.componentControls = new Set
        }
        subscribe(e) {
            return this.componentControls.add(e),
            () => this.componentControls.delete(e)
        }
        start(e, t) {
            this.componentControls.forEach(a => {
                a.start(e.nativeEvent || e, t)
            }
            )
        }
    }
    let m = () => new u;
    var g = e.i(811368)
      , x = e.i(394487);
    e.i(203772);
    var f = e.i(116395);
    e.i(817772);
    var h = e.i(895687)
      , p = e.i(429410)
      , v = e.i(636546)
      , b = e.i(294123);
    let j = function({value: e, onChange: a= () => {}
    , options: s, ...r}) {
        return (0,
        t.jsxs)("div", {
            className: "relative w-full",
            children: [(0,
            t.jsx)(b.default, {
                variant: "default",
                className: "pointer-events-none absolute inset-y-1/2 right-4 h-2 -translate-y-1/2 text-[#717171]"
            }), (0,
            t.jsx)("select", {
                ...r,
                value: e,
                onChange: e => {
                    let {value: t} = e.target;
                    a(t)
                }
                ,
                className: "block w-full appearance-none rounded-sm border-thin border-solid border-black/12 bg-white px-3 py-2 text-tui-sm leading-tui-lg text-gray-900",
                children: (0,
                v.map)(e => (0,
                t.jsx)("option", {
                    value: e.value,
                    children: e.label
                }, e.value))(s)
            })]
        })
    };
    var w = e.i(158602)
      , y = e.i(404383);
    e.i(690279);
    var N = e.i(947257)
      , T = e.i(674690)
      , k = e.i(254072)
      , C = e.i(219228)
      , M = e.i(884663)
      , E = e.i(546678)
      , P = e.i(771192)
      , L = e.i(400389)
      , z = e.i(514975)
      , F = e.i(830081)
      , I = e.i(995968)
      , R = e.i(3674);
    e.i(633995);
    var S = e.i(977160);
    let $ = ({onClick: e, iconName: a, className: r, children: l}) => (0,
    t.jsxs)("button", {
        type: "button",
        className: (0,
        s.default)(r, "group relative flex h-5 cursor-pointer items-center rounded-xs text-blue-500 ring-blue-700 ring-offset-4 hover:text-gray-500 focus-visible:text-gray-500 focus-visible:ring-2"),
        onClick: e,
        children: [(0,
        t.jsx)(S.Text, {
            size: "m",
            className: "font-bold tracking-tighter opacity-0",
            children: l
        }), (0,
        t.jsx)(S.Text, {
            size: "m",
            className: "absolute border-b-thin group-hover:border-b-thicker group-hover:font-bold group-hover:tracking-tighter group-focus-visible:border-b-thicker group-focus-visible:font-bold group-focus-visible:tracking-tighter",
            children: l
        }), a && (0,
        t.jsx)(h.default, {
            iconName: a,
            className: "ml-1"
        })]
    });
    var B = e.i(612180)
      , _ = e.i(250310);
    let q = ({children: e, isLoading: a, translation: s, languageName: r}) => a ? (0,
    t.jsx)("div", {
        className: "flex w-full flex-col gap-6",
        children: (0,
        _.range)(0, 6).map(e => (0,
        t.jsx)("div", {
            className: "w-full",
            children: (0,
            t.jsx)(B.default.Text, {
                lines: "3",
                color: {
                    override: "rgb(18 18 18 / 12%)"
                }
            })
        }, `transcript-loading-${e}`))
    }) : s ? (0,
    t.jsx)("div", {
        className: "w-full",
        children: e
    }) : (0,
    t.jsxs)("div", {
        className: "mt-10",
        children: [(0,
        t.jsxs)(f.Text, {
            tag: "p",
            children: ["Sorry, there is no transcript available for", " ", (0,
            t.jsxs)("strong", {
                className: "font-bold",
                children: [r || "this language", "."]
            })]
        }), (0,
        t.jsx)(f.Text, {
            tag: "p",
            children: "Please select another language."
        })]
    })
      , A = ({children: e}) => (0,
    t.jsx)("div", {
        className: "w-full border-b-thin border-gray-300",
        children: (0,
        t.jsx)(f.Text, {
            isBold: !0,
            variant: "subheader2",
            tag: "h3",
            children: e
        })
    })
      , D = ({time: e=0, className: l="", ...n}) => {
        let i = (0,
        a.useMemo)( () => (0,
        F.formatAsTimestamp)(e), [e])
          , {contentState: o} = (0,
        T.default)(e => ({
            ...e
        }), x.default)
          , c = "content" !== o;
        return (0,
        t.jsxs)("button", {
            type: "button",
            disabled: c,
            className: (0,
            s.default)("group flex items-center justify-between rounded-full bg-gray-50 px-3 py-2", {
                "w-20": !c
            }, l),
            tabIndex: 0,
            ...!c && {
                onClick: n.onClick
            },
            ...n,
            children: [(0,
            t.jsxs)("div", {
                className: (0,
                s.default)("relative flex h-4 w-4 items-center justify-center text-red-500", {
                    hidden: c
                }),
                children: [(0,
                t.jsx)(r.Icon, {
                    iconName: "play-filled",
                    className: "absolute size-full opacity-0 group-hover:opacity-100"
                }), (0,
                t.jsx)(r.Icon, {
                    iconName: "play",
                    className: "absolute size-full"
                })]
            }), (0,
            t.jsx)(f.Text, {
                variant: "body2",
                children: i
            })]
        })
    }
    ;
    var V = e.i(170470);
    let Q = (0,
    a.memo)( ({activeCue: e, cues: r, rtl: l, language: n}) => {
        let {requestContentTime: i, onTranscriptClick: o, onSeek: c, contentState: d} = (0,
        T.default)(e => ({
            ...e
        }), x.default)
          , u = "content" === d
          , m = (0,
        V.debounce)( () => {
            o()
        }
        , 500)
          , g = (0,
        a.useCallback)( (e, t) => {
            e.stopPropagation(),
            m(),
            i(t),
            c(t)
        }
        , []);
        return (0,
        a.useEffect)( () => {
            let e = document.querySelector(`.active-cue-${n}`);
            e && !(0,
            F.isElementInView)(e) && e.scrollIntoView({
                behavior: "smooth",
                block: "center"
            })
        }
        , [e, n]),
        (0,
        t.jsx)("div", {
            className: "w-full",
            children: (0,
            t.jsx)(f.Text, {
                direction: l,
                children: r.map( (a, r) => {
                    let l = Number(a.startTime) === e;
                    return (0,
                    t.jsx)("div", {
                        role: "button",
                        "aria-disabled": !u,
                        "aria-label": a.text,
                        onKeyDown: e => g(e, a.startTime),
                        onClick: e => g(e, a.startTime),
                        tabIndex: 0,
                        className: (0,
                        s.default)("inline", {
                            [`active-cue-${n}`]: l,
                            "bg-yellow-500 bg-opacity-25": l,
                            "pointer-events-none": !u,
                            "cursor-pointer hover:bg-red-300": u
                        }),
                        children: (0,
                        t.jsxs)(f.Text, {
                            children: [a.text, " "]
                        })
                    }, `cue-${a.startTime}-${a.text}-${r}`)
                }
                )
            })
        })
    }
    );
    var W = e.i(821067)
      , O = e.i(787918);
    let Y = ({children: e, targetRef: s, position: r=K, className: l, style: n, portal: i=!0}) => {
        let o = (0,
        a.useRef)(null)
          , [c,d] = a.default.useState({});
        (0,
        a.useEffect)( () => {
            let e = () => {
                d(r(s.current?.getBoundingClientRect() || null, o.current?.getBoundingClientRect() || null))
            }
            ;
            return e(),
            window.addEventListener("resize", e),
            window.addEventListener("scroll", e, !0),
            () => {
                window.removeEventListener("resize", e),
                window.removeEventListener("scroll", e, !0)
            }
        }
        , [r, s]);
        let u = (0,
        t.jsx)("div", {
            ref: o,
            className: l,
            style: {
                position: "absolute",
                ...n,
                ...c
            },
            children: e
        });
        return i ? (0,
        g.createPortal)(u, document.body) : u
    }
      , K = (e, t) => {
        if (!e || !t || null === window)
            return {};
        let a = e.left + e.width / 2 - t.width / 2;
        return {
            left: `${a + window.scrollX}px`,
            top: `${e.bottom + window.scrollY}px`
        }
    }
      , H = (e, t) => e && t && null !== window ? {
        top: `${e.top + e.height + window.pageYOffset}px`,
        left: `${e.right - t.width + window.pageXOffset}px`
    } : {};
    function U({targetRef: e, translator: a, isNativeLanguage: s, reviewer: r, onClose: l}) {
        let n = a || r
          , {panelStyleTokens: i} = (0,
        R.useTalkPageContext)();
        return (0,
        t.jsx)(Y, {
            targetRef: e,
            position: H,
            style: {
                zIndex: i.zIndex
            },
            children: (0,
            t.jsxs)("div", {
                className: "flex rounded-sm bg-white px-5 py-3 shadow-xl",
                children: [(0,
                t.jsx)("div", {
                    className: "absolute right-3",
                    children: (0,
                    t.jsx)("button", {
                        type: "button",
                        onClick: l,
                        className: "block",
                        children: (0,
                        t.jsx)(h.default, {
                            iconName: "x",
                            className: "hover:text-gray-500"
                        })
                    })
                }), (0,
                t.jsxs)("div", {
                    className: "pr-5",
                    children: [a && a.name?.full?.trim() && (0,
                    t.jsx)(X, {
                        user: a,
                        label: s ? (0,
                        t.jsx)(I.FormattedMessage, {
                            tagName: "span",
                            defaultMessage: "Transcriber",
                            id: "Transcript/TranslatorPopover.tsx_nqlVd6pE"
                        }) : (0,
                        t.jsx)(I.FormattedMessage, {
                            tagName: "span",
                            defaultMessage: "Translator",
                            id: "Transcript/TranslatorPopover.tsx_yvZLHkJb"
                        })
                    }), r && r.name?.full?.trim() && (0,
                    t.jsx)(X, {
                        user: r,
                        label: (0,
                        t.jsx)(I.FormattedMessage, {
                            tagName: "span",
                            defaultMessage: "Reviewer",
                            id: "Transcript/TranslatorPopover.tsx_Q058X+Cm"
                        })
                    }), n && (0,
                    t.jsx)(O.default, {
                        className: "mt-3"
                    }), (0,
                    t.jsx)("div", {
                        children: (0,
                        t.jsxs)("a", {
                            href: "https://www.ted.com/participate/translate",
                            className: "text-sm font-bold text-black hover:underline",
                            children: [(0,
                            t.jsx)(I.FormattedMessage, {
                                defaultMessage: "Become a Translator",
                                id: "Transcript/TranslatorPopover.tsx_RN2JRnKC"
                            }), " ", (0,
                            t.jsx)(h.default, {
                                iconName: "arrow-right"
                            })]
                        })
                    })]
                })]
            })
        })
    }
    let X = ({user: e, label: a}) => (0,
    t.jsx)("div", {
        className: "mt-3 min-w-[24px]",
        children: (0,
        t.jsxs)("div", {
            className: "flex items-center text-black",
            children: [(0,
            t.jsx)(W.default, {
                src: e?.avatar?.url ?? e?.avatar?.generatedUrl,
                size: 24,
                imgWidth: 96,
                className: "mr-2 h-6 w-6"
            }), (0,
            t.jsxs)("div", {
                className: "text-sm",
                children: [(0,
                t.jsxs)("a", {
                    href: e?.profilePath,
                    className: "font-bold hover:underline",
                    children: [e?.name?.full, ","]
                }), " ", a]
            })]
        })
    });
    var J = e.i(188771);
    let Z = () => {
        var e;
        let r = (0,
        n.useIsBreakpointWidth)({
            size: "sm",
            breakPointType: "ads"
        })
          , {slug: l, asPath: o, language: c} = (0,
        R.useTalkPageContext)()
          , {transcriptLanguage: d, setTranscriptLanguage: u} = (0,
        L.useTranscriptLanguagePreference)()
          , {contentState: m, convertedTime: g, languages: v, nativeLanguage: b, onSeek: S, onTranscriptLanguage: B, allSubtitles: _} = (0,
        T.default)(e => ({
            ...e
        }), x.default)
          , V = c || d || "en"
          , W = (0,
        a.useMemo)( () => {
            let e = V || "en"
              , t = P.default.getName(e) || "English";
            return {
                value: e,
                label: t
            }
        }
        , [V])
          , [O,Y] = (0,
        a.useState)(W)
          , [K,H] = (0,
        a.useState)(null)
          , [X,Z] = (0,
        a.useState)([])
          , [G,ee] = (0,
        a.useState)(!1)
          , et = (0,
        a.useRef)(null)
          , ea = (0,
        a.useRef)(null)
          , es = (0,
        a.useRef)({})
          , er = (0,
        a.useRef)({});
        (0,
        a.useEffect)( () => {
            c && !d && u(c)
        }
        , [c, d, u]),
        (0,
        a.useEffect)( () => {
            let e = V || "en";
            if (O.value !== e) {
                let t = P.default.getName(e) || "English";
                Y({
                    value: e,
                    label: t
                })
            }
            B(e)
        }
        , [V, O, B]);
        let el = (0,
        a.useMemo)( () => (0,
        M.compose)(e => e[e.length - 1] || "", e => e.split("#"), e => e || "")(o), [o])
          , en = (0,
        a.useMemo)( () => {
            if (!v)
                return [];
            let e = v.map( ({endonym: e, languageCode: t}) => ({
                label: e,
                value: t
            }));
            return e.find( ({value: e}) => e === W.value) || e.push(W),
            e.sort( (e, t) => e.label < t.label ? -1 : 1)
        }
        , [v, W])
          , {error: ei, data: eo, loading: ec} = function({id: e, language: t, ssr: a=!0}) {
            let s = (0,
            i.getLogger)("TranscriptQuery");
            return e ? t ? (0,
            z.useTranscriptQuery)({
                variables: {
                    id: e,
                    language: t
                },
                ssr: a,
                skip: !e || !t
            }) : (s.warn("Transcript query attempted without language"),
            {
                data: null,
                loading: !1,
                error: Error("Language is required for transcript query")
            }) : (s.warn("Transcript query attempted without ID"),
            {
                data: null,
                loading: !1,
                error: Error("ID is required for transcript query")
            })
        }({
            id: l,
            language: O.value
        })
          , ed = eo?.translation
          , eu = eo?.video?.talkExtras?.footnotes
          , {getFootnoteTimecodeFromParagraph: em, getParagraphCueTimeFromFootnote: eg} = (e = ed?.paragraphs,
        (0,
        a.useMemo)( () => {
            if (!e || !eu || 0 === eu.length)
                return {
                    getFootnoteTimecodeFromParagraph: p.noop,
                    getParagraphCueTimeFromFootnote: p.noop
                };
            let t = new Map
              , a = new Map;
            return e.forEach(e => {
                let s = eu.find(t => {
                    let a = function(e) {
                        let[t,a] = e.split(":");
                        return 60 * Number(t) * 1e3 + 1e3 * Number(a)
                    }(t.timecode);
                    return a >= e.cues[0].time && a <= (0,
                    J.last)(e.cues).time
                }
                );
                s && (t.set(e.cues[0].time, s.timecode),
                a.set(s.timecode, e.cues[0].time))
            }
            ),
            {
                getFootnoteTimecodeFromParagraph: e => t.get(e.cues[0].time),
                getParagraphCueTimeFromFootnote: e => a.get(e.timecode)
            }
        }
        , [eu, e]))
          , [ex] = function({when: e=!0, options: t}) {
            let s = (0,
            a.useRef)(null);
            return (0,
            a.useEffect)( () => {
                s.current && e && s.current.scrollIntoView(t)
            }
            , [s, e, t]),
            [s]
        }({
            when: (0,
            k.allPass)([(0,
            C.complement)( () => "content" === m), (0,
            C.complement)( () => ec), (0,
            C.complement)( () => !eu), (0,
            E.equals)("footnotes")])(el)
        })
          , ef = (0,
        a.useCallback)( (e, t) => {
            e.stopPropagation(),
            S(t)
        }
        , [S])
          , eh = (0,
        a.useCallback)(e => {
            e && !(0,
            F.isElementInView)(e) && e.scrollIntoView({
                behavior: "smooth",
                block: "center"
            })
        }
        , []);
        (0,
        a.useEffect)( () => {
            if (eo?.translation?.paragraphs && _) {
                let t = _[O.value] || [];
                try {
                    var e;
                    let a, s = (e = eo.translation.paragraphs,
                    a = new Set,
                    e.map(e => ({
                        ...e,
                        cues: e.cues.map(e => {
                            var s;
                            let r, l = (s = e.text,
                            r = t.findIndex( (e, t) => e.text.trim() === s.trim() && !a.has(t)),
                            -1 !== r ? (a.add(r),
                            t[r]) : null);
                            return l ? {
                                ...e,
                                startTime: l.startTime,
                                endTime: l.endTime
                            } : e
                        }
                        )
                    })));
                    Z(s || [])
                } catch (e) {
                    (0,
                    i.getLogger)("Transcript").error("Error mapping transcript data:", e),
                    Z([])
                }
            } else
                Z([])
        }
        , [eo, _, O]);
        let ep = (0,
        a.useMemo)( () => Array.isArray(X) && X.length ? X.flatMap(e => e?.cues?.length ? e.cues.map(e => ({
            text: e.text || "",
            startTime: e.startTime || 0,
            endTime: e.endTime || 0
        })) : []) : [], [X]);
        return (0,
        a.useEffect)( () => {
            if (!ep.length || "content" !== m)
                return;
            let e = ep.findIndex(e => g >= 1e3 * e.startTime && g < 1e3 * e.endTime);
            -1 !== e && H(ep[e]?.startTime ?? null)
        }
        , [m, g, ep]),
        (0,
        a.useEffect)( () => {
            if (!er.current || !K || "content" !== m)
                return;
            let e = er.current[K];
            e && e.scrollIntoView({
                behavior: "smooth"
            })
        }
        , [K, m]),
        (0,
        a.useEffect)( () => {
            if (!c)
                return;
            let e = c || "en"
              , t = P.default.getName(e) || "English"
              , a = {
                value: e,
                label: t
            };
            !en.some(t => t.value === e) && e ? (Y(a),
            B(e)) : Y(a)
        }
        , [c, en, B]),
        ei && (0,
        i.getLogger)("Transcript").error("Transcript load failed", ei),
        (0,
        t.jsxs)("div", {
            className: "mb-10 w-full",
            children: [(0,
            t.jsxs)("div", {
                className: "mx-auto mb-10 w-full",
                ref: ea,
                children: [(0,
                t.jsxs)("div", {
                    className: "flex justify-between",
                    children: [(0,
                    t.jsxs)("h4", {
                        children: [(0,
                        t.jsx)("span", {
                            className: "text-lg font-bold",
                            children: (0,
                            t.jsx)(I.FormattedMessage, {
                                defaultMessage: "Transcript",
                                id: "Transcript/Transcript.tsx_TztQA0vb"
                            })
                        }), " ", (0,
                        t.jsx)("span", {
                            className: "text-sm font-normal",
                            children: (0,
                            t.jsx)(I.FormattedMessage, {
                                defaultMessage: `{languages, plural,
                  =0 {}
                  one {(# Language)}
                  few {(# Languages)}
                  many {(# Languages)}
                  other {(# Languages)}
                }`,
                                id: "Transcript/Transcript.tsx_Q/XMfhzO",
                                description: "Used in the Transcripts header to describe the number of available languages",
                                values: {
                                    languages: v?.length || 0
                                }
                            })
                        })]
                    }), (0,
                    t.jsx)("div", {
                        ref: et,
                        children: (0,
                        t.jsx)("button", {
                            type: "button",
                            onClick: () => ee(e => !e),
                            children: (0,
                            t.jsx)(h.default, {
                                iconName: "more-horizontal"
                            })
                        })
                    }), G && (0,
                    t.jsx)(U, {
                        targetRef: et,
                        translator: ed?.translator,
                        reviewer: ed?.reviewer,
                        isNativeLanguage: b === O.value,
                        onClose: () => ee(!1)
                    })]
                }), (0,
                t.jsxs)("div", {
                    className: "mt-4 w-full",
                    children: [(0,
                    t.jsx)("div", {
                        className: "w-full max-w-64",
                        children: (0,
                        t.jsx)(j, {
                            className: "rounded-sm",
                            onChange: e => {
                                let t = en.find(t => t.value === e);
                                t && (u(e),
                                B(e),
                                Y(t))
                            }
                            ,
                            value: O.value,
                            options: en
                        })
                    }), (0,
                    t.jsxs)("div", {
                        className: "mb-8 mt-4 flex min-w-40 justify-between",
                        children: [ed?.translator?.name?.full?.trim() && (0,
                        t.jsxs)("div", {
                            className: "text-xs text-gray-700",
                            children: [(0,
                            t.jsxs)("a", {
                                href: ed.translator?.profilePath,
                                className: "font-bold hover:underline",
                                children: [ed.translator.name.full, ","]
                            }), " ", (0,
                            t.jsx)(I.FormattedMessage, {
                                tagName: "span",
                                defaultMessage: "Translator",
                                id: "Transcript/Transcript.tsx_yvZLHkJb"
                            })]
                        }), ed?.reviewer?.name?.full?.trim() && (0,
                        t.jsxs)("div", {
                            className: "text-xs text-gray-700",
                            children: [(0,
                            t.jsxs)("a", {
                                href: ed.reviewer?.profilePath,
                                className: "font-bold hover:underline",
                                children: [ed.reviewer.name.full, ","]
                            }), " ", (0,
                            t.jsx)(I.FormattedMessage, {
                                tagName: "span",
                                defaultMessage: " Reviewer",
                                id: "Transcript/Transcript.tsx_27t9IYTy"
                            })]
                        })]
                    })]
                }), (0,
                t.jsx)(N.Companion, {
                    type: "SmallRectangleThin",
                    path: "/ted3/web/talk",
                    identifier: "transcript-billboard",
                    className: (0,
                    s.default)("w-full", {
                        hidden: !r
                    })
                }), eu && eu?.length > 0 && (0,
                t.jsx)($, {
                    iconName: "arrow-down",
                    onClick: () => ex.current && eh(ex.current),
                    children: (0,
                    t.jsx)(I.FormattedMessage, {
                        defaultMessage: "Footnotes",
                        id: "Transcript/Transcript.tsx_t1Ql7YBE"
                    })
                }), (0,
                t.jsx)(q, {
                    isLoading: ec,
                    translation: ed,
                    languageName: O.label,
                    children: Array.isArray(X) && X.map( (e, a) => {
                        if (!e?.cues?.length)
                            return null;
                        let s = e.cues[0]?.startTime ?? 0
                          , r = em(e)
                          , l = `${s}-${e.cues[0]?.text?.slice(0, 10)}-${a}`;
                        return (0,
                        t.jsxs)("div", {
                            ref: t => {
                                t && e.cues[0]?.time && (er.current[e.cues[0].time] = t)
                            }
                            ,
                            className: "mb-6 w-full",
                            children: [(0,
                            t.jsxs)("div", {
                                className: "mb-5 mt-10 flex items-center",
                                children: [(0,
                                t.jsx)(D, {
                                    time: s,
                                    onClick: e => ef(e, s)
                                }, l), null != r && (0,
                                t.jsx)($, {
                                    onClick: () => {
                                        let e = es.current[r];
                                        e && eh(e)
                                    }
                                    ,
                                    className: "ml-6",
                                    children: (0,
                                    t.jsx)(I.FormattedMessage, {
                                        defaultMessage: "footnote",
                                        id: "Transcript/Transcript.tsx_5mn8gnzM"
                                    })
                                })]
                            }), (0,
                            t.jsx)(Q, {
                                activeCue: K ?? 0,
                                cues: e.cues,
                                rtl: ed?.language?.rtl ? "rtl" : "ltr",
                                language: O.value
                            })]
                        }, l)
                    }
                    )
                })]
            }), eu && eu?.length > 0 && (0,
            t.jsxs)("div", {
                ref: ex,
                className: "w-full",
                children: [(0,
                t.jsxs)("div", {
                    className: "relative mb-10 flex flex-row items-end justify-between",
                    children: [(0,
                    t.jsx)(A, {
                        children: (0,
                        t.jsx)(I.FormattedMessage, {
                            defaultMessage: "Footnotes",
                            id: "Transcript/Transcript.tsx_t1Ql7YBE"
                        })
                    }), (0,
                    t.jsx)($, {
                        iconName: "arrow-up",
                        onClick: () => ea.current && eh(ea.current),
                        children: (0,
                        t.jsx)(I.FormattedMessage, {
                            defaultMessage: "top",
                            id: "Transcript/Transcript.tsx_D6yns0qx"
                        })
                    })]
                }), (0,
                t.jsx)("div", {
                    className: "w-full",
                    children: eu.map(e => {
                        let {timecode: a, author: s, category: r, text: l, title: n, date: i, linkUrl: o, annotation: c, source: d} = e
                          , u = a && (0,
                        F.timestampToSeconds)(a)
                          , m = eg(e);
                        return (0,
                        t.jsxs)("div", {
                            ref: e => {
                                es.current[a] = e
                            }
                            ,
                            className: "mb-10",
                            children: [u && (0,
                            t.jsxs)("div", {
                                className: "mb-6 flex items-center justify-between",
                                children: [(0,
                                t.jsx)(D, {
                                    time: u,
                                    onClick: e => ef(e, u)
                                }), null != m && (0,
                                t.jsx)($, {
                                    onClick: () => {
                                        er.current[m].scrollIntoView({
                                            behavior: "smooth"
                                        })
                                    }
                                    ,
                                    className: "ml-6",
                                    iconName: "arrow-up",
                                    children: (0,
                                    t.jsx)(I.FormattedMessage, {
                                        defaultMessage: "Back",
                                        id: "Transcript/Transcript.tsx_cyR7Khiu"
                                    })
                                })]
                            }), r && (0,
                            t.jsx)("div", {
                                className: "mb-6 text-sm capitalize text-gray-500",
                                children: r
                            }), l && (0,
                            t.jsx)(f.Text, {
                                tag: "p",
                                variant: "header4",
                                children: (0,
                                t.jsx)(w.default, {
                                    children: l
                                })
                            }), (0,
                            t.jsxs)("div", {
                                className: "mb-2 flex flex-col gap-1",
                                children: [n && (0,
                                t.jsx)(f.Text, {
                                    tag: "p",
                                    isBold: !0,
                                    children: (0,
                                    t.jsx)(w.default, {
                                        children: n
                                    })
                                }), s && (0,
                                t.jsxs)("div", {
                                    className: "inline",
                                    children: [(0,
                                    t.jsx)(w.default, {
                                        children: s
                                    }), i && (0,
                                    t.jsx)(w.default, {
                                        children: `, ${i}`
                                    })]
                                }), o && (0,
                                t.jsx)(y.Link, {
                                    className: "underline",
                                    href: o,
                                    children: (0,
                                    t.jsx)(f.Text, {
                                        tag: "p",
                                        children: (0,
                                        t.jsx)(w.default, {
                                            children: d
                                        })
                                    })
                                })]
                            }), c && (0,
                            t.jsx)(f.Text, {
                                tag: "p",
                                children: (0,
                                t.jsx)(w.default, {
                                    children: c
                                })
                            })]
                        }, `${a}${s ? `-${s}` : ""}`)
                    }
                    )
                })]
            })]
        })
    }
      , G = (0,
    i.getLogger)("TranscriptsWrapper")
      , ee = [.7, .65, .6, .55, .5, .45, .4, .35, .3]
      , et = (0,
    a.memo)(function({isVisible: e, onToggle: i}) {
        let u = (0,
        l.useDidMount)()
          , x = (0,
        n.useIsBreakpointWidth)({
            size: "sm",
            breakPointType: "tui"
        })
          , f = (0,
        n.useIsBreakpointWidth)({
            size: "lg",
            breakPointType: "tui"
        })
          , h = (0,
        n.useIsBreakpointWidth)({
            size: "lg"
        })
          , p = (0,
        a.useRef)(null)
          , v = h || f || x
          , b = (0,
        d.useConstant)(m)
          , [j,w] = (0,
        a.useState)(ee[0])
          , [y,N] = (0,
        a.useState)(1)
          , T = () => {
            let e = document.getElementById("video-player-container");
            if (!e)
                return void G.error("Could not find video player container");
            let t = e.getBoundingClientRect()
              , a = (window.innerHeight - t.bottom) / window.innerHeight
              , s = ee.reduce( (e, t) => Math.abs(t - a) < Math.abs(e - a) ? t : e);
            s ? w(s) : w(ee[0])
        }
        ;
        (0,
        a.useEffect)( () => {
            if (u)
                return T(),
                window.addEventListener("resize", T),
                () => {
                    window.removeEventListener("resize", T)
                }
        }
        , [u]),
        (0,
        a.useEffect)( () => {
            e && u && (T(),
            N(0))
        }
        , [e, u]),
        (0,
        a.useEffect)( () => {
            if (e && v) {
                let e = window.scrollY
                  , t = window.getComputedStyle(document.body).overflow
                  , a = window.getComputedStyle(document.body).position;
                return document.body.style.position = "fixed",
                document.body.style.top = `-${e}px`,
                document.body.style.width = "100%",
                document.body.style.overflow = "hidden",
                () => {
                    document.body.style.position = a,
                    document.body.style.top = "",
                    document.body.style.width = "",
                    document.body.style.overflow = t,
                    window.scrollTo(0, e)
                }
            }
        }
        , [e, v]);
        let k = [j, .9][y]
          , C = `${100 * k}dvh`
          , M = (0,
        t.jsx)(o.AnimatePresence, {
            children: e && (0,
            t.jsxs)(t.Fragment, {
                children: [(0,
                t.jsx)(c.motion.div, {
                    initial: {
                        opacity: 0
                    },
                    animate: {
                        opacity: 1
                    },
                    exit: {
                        opacity: 0
                    },
                    transition: {
                        duration: .2
                    },
                    className: "fixed inset-0 z-40 bg-black/20",
                    onClick: i
                }), (0,
                t.jsxs)(c.motion.div, {
                    initial: {
                        y: "100%"
                    },
                    animate: {
                        y: 0,
                        height: C
                    },
                    exit: {
                        y: "100%"
                    },
                    transition: {
                        type: "spring",
                        damping: 30,
                        stiffness: 300
                    },
                    drag: "y",
                    dragControls: b,
                    dragConstraints: {
                        top: 0,
                        bottom: 0
                    },
                    dragElastic: {
                        top: .1,
                        bottom: .2
                    },
                    onDragEnd: (e, t) => {
                        let a = t.velocity.y
                          , s = t.offset.y;
                        s > 100 || a > 500 ? i() : a < -500 || s < -50 ? N(1) : (a > 500 || s > 50) && N(0)
                    }
                    ,
                    style: {
                        height: C
                    },
                    className: "fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-white shadow-2xl",
                    children: [(0,
                    t.jsxs)("div", {
                        className: "flex w-full shrink-0 cursor-grab items-center justify-between px-4 pb-2 pt-3 active:cursor-grabbing",
                        onPointerDown: e => b.start(e),
                        children: [(0,
                        t.jsx)("div", {
                            className: "w-6"
                        }), (0,
                        t.jsx)("div", {
                            className: "h-1 w-12 rounded-full bg-gray-400"
                        }), (0,
                        t.jsx)("button", {
                            type: "button",
                            onClick: t => {
                                t.stopPropagation(),
                                e && i()
                            }
                            ,
                            className: "text-gray-600 flex h-6 w-6 items-center justify-center hover:text-gray-900",
                            children: (0,
                            t.jsx)(r.Icon, {
                                iconName: "x",
                                className: "text-2xl"
                            })
                        })]
                    }), (0,
                    t.jsx)("div", {
                        ref: p,
                        className: "flex-1 overflow-y-auto px-4 pb-8",
                        style: {
                            WebkitOverflowScrolling: "touch"
                        },
                        children: (0,
                        t.jsx)(Z, {})
                    })]
                })]
            })
        });
        return v ? "u" > typeof document ? (0,
        g.createPortal)(M, document.body) : null : (0,
        t.jsx)("section", {
            className: (0,
            s.default)("lg:h-auto", {
                open: e
            }),
            children: (0,
            t.jsx)("div", {
                className: "w-full overflow-y-auto px-4 lg:overflow-hidden lg:px-0",
                style: {
                    marginTop: 50
                },
                children: e && (0,
                t.jsx)(Z, {})
            })
        })
    }, x.shallow);
    e.s(["default", 0, et], 624063)
}
, 512425, e => {
    e.n(e.i(624063))
}
]);
