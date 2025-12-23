## refactor graph page layout:
- put footer info "561 entities, 618 relationships" in header, to the same line as the search. (remove the complete footer div)
- put the filter buttons in the same line next to the search
- add a reset input function to the search input
- make the background of the filter buttons opaque 
- add a semi transparent background to the complete graph header (search input, filter buttons, footer info)
- add a reset button to the graph header

## refactor library page layout:
- add a reset input function to the search input





## features
- add a button "do websearch" to the entity sidebar. this function should create a search query, execute it and return some document previews that can be added to the library
- document categorisation/tagging 
- filter graph by category/tag option


- show nodes titles with most connections in a cluster overlay (bigger bold font, semi transparent) when graph is zoomed out

where can i adjust the parameter that decides when a cluster title is shown or not?