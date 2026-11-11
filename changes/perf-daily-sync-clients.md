### Fixed

- **A daily `sync` no longer reads every client again.** A round of changes read every contact and company named on
  the chosen users' deals and leads, whether or not anything changed: on a portal with 50,000 deals that was about
  300 requests and close to three minutes for a sync with nothing new. It now reads only the clients of the deals and
  leads that changed, and lists the users' deals for their clients once a sync instead of once for contacts and once
  for companies.
