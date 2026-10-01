// Adapted from T3 Code (MIT), packages/client-runtime/src/device/phoneInteraction.ts and
// apps/web/src/components/device/phoneTrackpad.ts. See THIRD_PARTY_NOTICES.md.

type Point = { readonly x: number; readonly y: number }

/** A single pointer owns either a device gesture or an orbit until released or cancelled. */
export function createDeviceInteraction(options: {
  readonly screenPoint: (point: Point, captured: boolean) => Point | null
  readonly touch: (phase: "begin" | "move" | "end", point: Point) => void
  readonly orbit: (deltaX: number, deltaY: number) => void
  readonly onInteractionActive?: (active: boolean, mode: "touch" | "orbit") => void
}) {
  let active: { id: number; mode: "touch" | "orbit"; last: Point; screen: Point | null } | null =
    null
  return {
    /** Wheel orbit is refused during a captured touch; moving the camera would shift its projection. */
    orbitBy(deltaX: number, deltaY: number) {
      if (active) return false
      options.orbit(deltaX, deltaY)
      return true
    },
    endWheel() {
      if (!active) options.onInteractionActive?.(false, "orbit")
    },
    begin(id: number, point: Point, forceOrbit = false) {
      if (active) return false
      const screen = forceOrbit ? null : options.screenPoint(point, false)
      active = { id, mode: screen ? "touch" : "orbit", last: point, screen }
      options.onInteractionActive?.(true, active.mode)
      if (screen) options.touch("begin", screen)
      return true
    },
    move(id: number, point: Point) {
      if (active?.id !== id) return
      if (active.mode === "touch") {
        const screen = options.screenPoint(point, true)
        if (screen) {
          active.screen = screen
          options.touch("move", screen)
        }
      } else {
        options.orbit(point.x - active.last.x, point.y - active.last.y)
      }
      active.last = point
    },
    end(id?: number) {
      if (!active || (id !== undefined && active.id !== id)) return
      const previous = active
      active = null
      if (previous.mode === "touch" && previous.screen) options.touch("end", previous.screen)
      options.onInteractionActive?.(false, previous.mode)
    },
  }
}

export type DeviceInteraction = ReturnType<typeof createDeviceInteraction>

/** Two-finger trackpad swipes orbit the body. Pinch-zoom (ctrl+wheel) is left to the browser. */
export function bindTrackpadOrbit(canvas: HTMLCanvasElement, interaction: DeviceInteraction) {
  let orbitActive = false
  let orbitTimer: number | undefined
  const endOrbit = () => {
    window.clearTimeout(orbitTimer)
    orbitTimer = undefined
    if (!orbitActive) return
    orbitActive = false
    interaction.endWheel()
  }
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey) return
    event.preventDefault()
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1
    const clamp = (value: number) => Math.min(0.25, Math.max(-0.25, value))
    const x = clamp((-event.deltaX * unit) / rect.width)
    const y = clamp((-event.deltaY * unit) / rect.height)
    if (!interaction.orbitBy(x, y)) return
    orbitActive = true
    window.clearTimeout(orbitTimer)
    // Wheel events have no release signal; settle back to a useful view once they stop.
    orbitTimer = window.setTimeout(endOrbit, 180)
  }
  canvas.addEventListener("wheel", wheel, { passive: false })
  return {
    cancel: endOrbit,
    dispose() {
      canvas.removeEventListener("wheel", wheel)
      endOrbit()
    },
  }
}
