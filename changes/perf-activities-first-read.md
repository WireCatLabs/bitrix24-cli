### Fixed

- `crm sync` with activities on reads only the activities on your own deals and leads, fifty deals or leads per
  request, instead of every activity on the portal. The first read of a large portal took about four minutes for a
  handful of activities; it now takes as many requests as you have deals and leads, divided by fifty.
