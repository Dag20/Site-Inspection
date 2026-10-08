-- Development only: the login the API uses. It is not a superuser, so row-level security applies to it.
-- Migrations create the app_rw group role and grant it table access; this login only needs membership.
CREATE ROLE app_rw NOLOGIN;
CREATE ROLE app_user LOGIN PASSWORD 'app_user' IN ROLE app_rw;
