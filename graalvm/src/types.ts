/*
 * Copyright (c) 2023, Oracle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */

export type GraalVMComponent = {
    id: string;
    name: string;
    installed?: boolean;
    isLicenseImplicitlyAccepted?: boolean;
};

export type Cache<K extends string | number | symbol, T> = { [P in K]: T };