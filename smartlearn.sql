--
-- PostgreSQL database dump
--



-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

-- Started on 2026-03-15 18:33:56
--SET ROLE postgres;

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 220 (class 1259 OID 16406)
-- Name: auth_providers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.auth_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    provider character varying(50),
    provider_user_id text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- TOC entry 221 (class 1259 OID 16421)
-- Name: student_profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.student_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    school_name text,
    district text,
    state text,
    country text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--ALTER TABLE public.student_profiles OWNER TO postgres;

--
-- TOC entry 224 (class 1259 OID 16469)
-- Name: teacher_password_otp; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.teacher_password_otp (
    email character varying(255),
    otp character varying(6),
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--ALTER TABLE public.teacher_password_otp OWNER TO postgres;

--
-- TOC entry 223 (class 1259 OID 16455)
-- Name: teachers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.teachers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    first_name character varying(150),
    last_name character varying(150),
    email character varying(255),
    mobile_number character varying(20),
    password text,
    is_first_login boolean DEFAULT true,
    account_status character varying(20) DEFAULT 'active'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--ALTER TABLE public.teachers OWNER TO postgres;

--
-- TOC entry 222 (class 1259 OID 16443)
-- Name: user_academic_details; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_academic_details (
    user_id uuid,
    school_name character varying(255),
    district character varying(150),
    state character varying(150),
    country character varying(150) DEFAULT 'India'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--ALTER TABLE public.user_academic_details OWNER TO postgres;

--
-- TOC entry 219 (class 1259 OID 16391)
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    first_name character varying(100),
    last_name character varying(100),
    mobile_number character varying(20),
    role character varying(20),
    is_onboarded boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    google_id text,
    profile_picture text,
    last_login timestamp without time zone,
    auth_provider text DEFAULT 'google'::text,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['student'::character varying, 'teacher'::character varying])::text[])))
);


--ALTER TABLE public.users OWNER TO postgres;

--
-- TOC entry 5060 (class 0 OID 16406)
-- Dependencies: 220
-- Data for Name: auth_providers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.auth_providers (id, user_id, provider, provider_user_id, created_at) FROM stdin;



--
-- TOC entry 5061 (class 0 OID 16421)
-- Dependencies: 221
-- Data for Name: student_profiles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.student_profiles (id, user_id, school_name, district, state, country, created_at) FROM stdin;



--
-- TOC entry 5064 (class 0 OID 16469)
-- Dependencies: 224
-- Data for Name: teacher_password_otp; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.teacher_password_otp (email, otp, expires_at, created_at) FROM stdin;



--
-- TOC entry 5063 (class 0 OID 16455)
-- Dependencies: 223
-- Data for Name: teachers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.teachers (id, first_name, last_name, email, mobile_number, password, is_first_login, account_status, created_at) FROM stdin;



--
-- TOC entry 5062 (class 0 OID 16443)
-- Dependencies: 222
-- Data for Name: user_academic_details; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_academic_details (user_id, school_name, district, state, country, created_at) FROM stdin;


--
-- TOC entry 5059 (class 0 OID 16391)
-- Dependencies: 219
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, email, first_name, last_name, mobile_number, role, is_onboarded, created_at, google_id, profile_picture, last_login, auth_provider) FROM stdin;


--
-- TOC entry 4902 (class 2606 OID 16415)
-- Name: auth_providers auth_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_providers
    ADD CONSTRAINT auth_providers_pkey PRIMARY KEY (id);


--
-- TOC entry 4904 (class 2606 OID 16430)
-- Name: student_profiles student_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_profiles
    ADD CONSTRAINT student_profiles_pkey PRIMARY KEY (id);


--
-- TOC entry 4906 (class 2606 OID 16468)
-- Name: teachers teachers_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_email_key UNIQUE (email);


--
-- TOC entry 4908 (class 2606 OID 16466)
-- Name: teachers teachers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_pkey PRIMARY KEY (id);


--
-- TOC entry 4892 (class 2606 OID 16440)
-- Name: users unique_email; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT unique_email UNIQUE (email);


--
-- TOC entry 4894 (class 2606 OID 16442)
-- Name: users unique_google; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT unique_google UNIQUE (google_id);


--
-- TOC entry 4896 (class 2606 OID 16405)
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- TOC entry 4898 (class 2606 OID 16437)
-- Name: users users_google_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_google_id_key UNIQUE (google_id);


--
-- TOC entry 4900 (class 2606 OID 16403)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 4909 (class 2606 OID 16416)
-- Name: auth_providers auth_providers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.auth_providers
    ADD CONSTRAINT auth_providers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 4910 (class 2606 OID 16431)
-- Name: student_profiles student_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_profiles
    ADD CONSTRAINT student_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 4911 (class 2606 OID 16450)
-- Name: user_academic_details user_academic_details_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_academic_details
    ADD CONSTRAINT user_academic_details_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


-- Completed on 2026-03-15 18:33:56

--
-- PostgreSQL database dump complete
--



