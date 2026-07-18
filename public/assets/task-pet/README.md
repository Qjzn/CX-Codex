# CX task-pet artwork

The CX companion is the product task-pet character derived from the CX-Codex
loop-and-X logo. Its white inner shell, navy face and cyan core remain readable
at both the 88 x 96 dp overlay size and the 48 dp minimized size. Five
transparent PNG masters cover the states used by Web and Android:

- `cx-pet-idle.png`: no active task
- `cx-pet-working.png`: at least one active task
- `cx-pet-waiting.png`: a task needs user attention
- `cx-pet-completed.png`: unread completed-task record
- `cx-pet-dragging.png`: the overlay is being dragged

Runtime masters are 512 x 512 PNGs. The higher-resolution generation sources
stay outside the application bundle so small overlay rendering does not pay the
decode-memory or package-size cost of the production artwork pipeline.

The product combines the state artwork with short platform-native transforms:
a lift while work starts, an attention tilt while waiting, a completion pop,
and live drag lean. These transforms run only after a real state or touch
change; the slower idle animation is reserved for the visible full pet.

Each state also has a four-frame `cx-pet-*-animated.webp` master generated from
its matching CX character sprite sheet. The visible full pet uses the animation
on Web and Android 9+, while reduced-motion Web rendering, Android 8 and older,
and the 48 dp minimized bubble use the matching still PNG. Native decoding is
stopped whenever the full pet is hidden or the service is destroyed.

The artwork was generated specifically for CX-Codex without copying a
third-party character or asset. It follows the repository's MIT license.
