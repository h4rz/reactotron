import React, { useEffect, useMemo, useRef, useState } from "react"
import { LuCheck, LuChevronDown, LuSearch } from "react-icons/lu"
import styled from "styled-components"

import {
  fallbackInterfaceFonts,
  fallbackMonospaceFonts,
  isMonospaceFamily,
  queryInstalledFontFamilies,
} from "../../typography"

const Picker = styled.div`
  position: relative;
  min-width: 0;
`

const Trigger = styled.button`
  display: flex;
  width: 100%;
  height: 36px;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px 0 11px;
  border: 1px solid ${(props) => props.theme.chromeLine};
  border-radius: 8px;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.foreground};
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  text-align: left;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  svg {
    width: 14px;
    height: 14px;
    flex: 0 0 14px;
    opacity: 0.55;
  }

  &:focus-visible {
    outline: 2px solid ${(props) => props.theme.highlight};
    outline-offset: 1px;
  }
`

const Popup = styled.div`
  position: absolute;
  z-index: 40;
  top: calc(100% + 7px);
  right: 0;
  display: flex;
  width: 290px;
  max-width: min(290px, calc(100vw - 48px));
  flex-direction: column;
  overflow: hidden;
  border: 1px solid ${(props) => props.theme.chromeLine};
  border-radius: 10px;
  background: ${(props) => props.theme.backgroundLighter};
  box-shadow: 0 16px 40px ${(props) => props.theme.glow};
`

const SearchWrap = styled.div`
  position: relative;
  margin: 10px 12px 4px;
  border-bottom: 1px solid ${(props) => props.theme.chromeLine};

  svg {
    position: absolute;
    top: 9px;
    left: 2px;
    width: 15px;
    height: 15px;
    color: ${(props) => props.theme.foregroundDark};
  }
`

const SearchInput = styled.input`
  width: 100%;
  height: 34px;
  box-sizing: border-box;
  padding: 0 4px 0 23px;
  border: 0;
  outline: 0;
  background: transparent;
  color: ${(props) => props.theme.foreground};
  font: inherit;
  font-size: 13px;

  &::placeholder {
    color: ${(props) => props.theme.foregroundDark};
  }
`

const FontList = styled.div`
  max-height: 280px;
  overflow-y: auto;
  padding: 5px 8px 8px;
`

const FontListSpacer = styled.div<{ $height: number }>`
  position: relative;
  height: ${(props) => props.$height}px;
`

const FontOption = styled.button<{ $isHighlighted: boolean; $top: number }>`
  position: absolute;
  top: ${(props) => props.$top}px;
  right: 0;
  left: 0;
  display: flex;
  width: 100%;
  height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 5px 9px;
  border: 0;
  border-radius: 7px;
  background: ${(props) =>
    props.$isHighlighted ? props.theme.backgroundHighlight : "transparent"};
  color: ${(props) => props.theme.foreground};
  cursor: pointer;
  font-size: 15px;
  text-align: left;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  svg {
    width: 15px;
    height: 15px;
    flex: 0 0 15px;
    color: ${(props) => props.theme.highlight};
  }

  &:hover {
    background: ${(props) => props.theme.backgroundHighlight};
  }
`

const EmptyState = styled.p`
  margin: 0;
  padding: 16px 10px;
  color: ${(props) => props.theme.foregroundDark};
  font-size: 12px;
  text-align: center;
`

let installedFontCache: readonly string[] | null = null
let installedFontRequest: Promise<readonly string[]> | null = null
const fontRowHeight = 34
const fontListHeight = 280
const fontListOverscan = 4

function loadInstalledFonts(): Promise<readonly string[]> {
  if (installedFontCache) return Promise.resolve(installedFontCache)
  if (!installedFontRequest) {
    installedFontRequest = queryInstalledFontFamilies().then((fonts) => {
      installedFontCache = fonts
      installedFontRequest = null
      return fonts
    })
  }
  return installedFontRequest
}

interface Props {
  ariaLabel: string
  value: string
  requireMonospace?: boolean
  onChange: (font: string) => void
}

export default function FontFamilyPicker({
  ariaLabel,
  value,
  requireMonospace = false,
  onChange,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [installedFonts, setInstalledFonts] = useState<readonly string[]>(installedFontCache ?? [])
  const [loading, setLoading] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)

  const fallbackFonts = requireMonospace ? fallbackMonospaceFonts : fallbackInterfaceFonts
  const fonts = useMemo(() => {
    const discovered = requireMonospace ? installedFonts.filter(isMonospaceFamily) : installedFonts
    return Array.from(
      new Set([...fallbackFonts.map((option) => option.label), ...discovered])
    ).sort((left, right) => left.localeCompare(right))
  }, [fallbackFonts, installedFonts, requireMonospace])

  const filteredFonts = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return normalized ? fonts.filter((font) => font.toLowerCase().includes(normalized)) : fonts
  }, [fonts, query])

  const visibleRange = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / fontRowHeight) - fontListOverscan)
    const visibleCount = Math.ceil(fontListHeight / fontRowHeight) + fontListOverscan * 2
    return { start, end: Math.min(filteredFonts.length, start + visibleCount) }
  }, [filteredFonts.length, scrollTop])

  const visibleFonts = filteredFonts.slice(visibleRange.start, visibleRange.end)

  useEffect(() => {
    if (!open) return undefined
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", closeOnOutsideClick)
    return () => document.removeEventListener("mousedown", closeOnOutsideClick)
  }, [open])

  useEffect(() => {
    setHighlightedIndex(0)
    setScrollTop(0)
    if (listRef.current) listRef.current.scrollTop = 0
  }, [query])

  useEffect(() => {
    if (!open || !listRef.current) return
    const rowTop = highlightedIndex * fontRowHeight
    const rowBottom = rowTop + fontRowHeight
    const viewportTop = listRef.current.scrollTop
    const viewportBottom = viewportTop + fontListHeight

    if (rowTop < viewportTop) listRef.current.scrollTop = rowTop
    else if (rowBottom > viewportBottom) listRef.current.scrollTop = rowBottom - fontListHeight
  }, [highlightedIndex, open])

  const openPicker = () => {
    setOpen(true)
    setQuery("")
    setScrollTop(0)
    setLoading(true)
    window.setTimeout(() => searchRef.current?.focus(), 0)
    loadInstalledFonts().then((fonts) => {
      setInstalledFonts(fonts)
      setLoading(false)
      window.setTimeout(() => searchRef.current?.focus(), 0)
    })
  }

  const selectFont = (font: string) => {
    onChange(fallbackFonts.find((option) => option.label === font)?.value ?? font)
    setOpen(false)
  }

  const isSelected = (font: string) =>
    (fallbackFonts.find((option) => option.label === font)?.value ?? font) === value

  return (
    <Picker ref={rootRef}>
      <Trigger
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPicker())}
      >
        <span>{fallbackFonts.find((option) => option.value === value)?.label ?? value}</span>
        <LuChevronDown aria-hidden="true" />
      </Trigger>
      {open && (
        <Popup>
          <SearchWrap>
            <LuSearch aria-hidden="true" />
            <SearchInput
              ref={searchRef}
              role="combobox"
              aria-label={`Search ${ariaLabel.toLowerCase()}`}
              aria-controls={`${ariaLabel.replace(/ /g, "-")}-listbox`}
              aria-expanded="true"
              placeholder="Search fonts…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault()
                  setOpen(false)
                } else if (event.key === "ArrowDown") {
                  event.preventDefault()
                  setHighlightedIndex((index) => Math.min(index + 1, filteredFonts.length - 1))
                } else if (event.key === "ArrowUp") {
                  event.preventDefault()
                  setHighlightedIndex((index) => Math.max(index - 1, 0))
                } else if (event.key === "Enter" && filteredFonts[highlightedIndex]) {
                  event.preventDefault()
                  selectFont(filteredFonts[highlightedIndex])
                }
              }}
            />
          </SearchWrap>
          <FontList
            ref={listRef}
            id={`${ariaLabel.replace(/ /g, "-")}-listbox`}
            role="listbox"
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
            {loading && <EmptyState>Loading installed fonts…</EmptyState>}
            {filteredFonts.length === 0 ? (
              <EmptyState>No fonts found.</EmptyState>
            ) : (
              <FontListSpacer $height={filteredFonts.length * fontRowHeight}>
                {visibleFonts.map((font, offset) => {
                  const index = visibleRange.start + offset
                  return (
                    <FontOption
                      key={font}
                      type="button"
                      role="option"
                      aria-posinset={index + 1}
                      aria-setsize={filteredFonts.length}
                      aria-selected={isSelected(font)}
                      $isHighlighted={index === highlightedIndex}
                      $top={index * fontRowHeight}
                      onMouseEnter={() =>
                        setHighlightedIndex((current) => (current === index ? current : index))
                      }
                      onClick={() => selectFont(font)}
                      style={{ fontFamily: `"${font.replace(/"/g, "")}"` }}
                    >
                      <span>{font}</span>
                      {isSelected(font) && <LuCheck aria-hidden="true" />}
                    </FontOption>
                  )
                })}
              </FontListSpacer>
            )}
          </FontList>
        </Popup>
      )}
    </Picker>
  )
}
